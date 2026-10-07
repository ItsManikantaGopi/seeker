// Package segment is Chapter 11: the storage model. Segments are immutable;
// deletes are tombstones; a background merge rewrites segments to reclaim
// them; every file is checksummed so corruption cannot hide.
package segment

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"hash/crc32"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"kaus-go/internal/model"
)

// Format constants: magic bytes, a version, a body, a checksum, a footer.
var (
	Magic   = []byte{'S', 'K', 'R', '1'}
	Version = uint16(1)
)

var ErrChecksum = errors.New("segment checksum mismatch")

// SegmentDoc is one document as stored inside a segment file.
type SegmentDoc struct {
	ID     string
	Source map[string]any
}

// Segment is an immutable batch of documents.
type Segment struct {
	Name string
	docs []SegmentDoc
}

// NewSegment batches documents into one immutable segment.
func NewSegment(name string, docs []model.Document) *Segment {
	s := &Segment{Name: name}
	for _, d := range docs {
		s.docs = append(s.docs, SegmentDoc{ID: d.ID, Source: d.Source})
	}
	return s
}

// Docs exposes stored documents (read-only by convention).
func (s *Segment) Docs() []SegmentDoc { return s.docs }

// Encode writes the byte format:
//
//	magic "SKR1" | version u16 | docCount u32
//	  per doc: idLen vint | id bytes | jsonLen vint | json bytes
//	crc32 of everything above | footer magic
func (s *Segment) Encode() ([]byte, error) {
	var buf bytes.Buffer
	buf.Write(Magic)
	binary.Write(&buf, binary.LittleEndian, Version)
	binary.Write(&buf, binary.LittleEndian, uint32(len(s.docs)))

	for _, d := range s.docs {
		jsonBytes, err := jsonMarshal(d.Source)
		if err != nil {
			return nil, fmt.Errorf("encode doc %q: %w", d.ID, err)
		}
		writeUvarint(&buf, len(d.ID))
		buf.WriteString(d.ID)
		writeUvarint(&buf, len(jsonBytes))
		buf.Write(jsonBytes)
	}

	checksum := crc32.ChecksumIEEE(buf.Bytes())
	binary.Write(&buf, binary.LittleEndian, checksum)
	buf.Write(Magic) // footer magic catches truncated tails
	return buf.Bytes(), nil
}

// Decode reads a segment back, verifying magic, version and CRC.
func Decode(data []byte) (*Segment, error) {
	if len(data) < 14+8 { // header + crc + footer magic minimum
		return nil, ErrChecksum
	}
	// Integrity first: validate the checksum and footer BEFORE trusting any
	// parsed lengths. A corrupt count field would otherwise send the parser
	// walking off the end of the buffer.
	stored := binary.LittleEndian.Uint32(data[len(data)-8:])
	if crc32.ChecksumIEEE(data[:len(data)-8]) != stored {
		return nil, ErrChecksum
	}
	if tail := data[len(data)-4:]; !bytes.Equal(tail, Magic) {
		return nil, errors.New("bad segment footer")
	}

	r := bytes.NewReader(data)
	head := make([]byte, 4)
	io.ReadFull(r, head)
	if !bytes.Equal(head, Magic) {
		return nil, errors.New("bad segment magic")
	}
	var version uint16
	binary.Read(r, binary.LittleEndian, &version)
	if version != Version {
		return nil, fmt.Errorf("unsupported segment version %d", version)
	}
	var count uint32
	binary.Read(r, binary.LittleEndian, &count)

	s := &Segment{}
	for i := uint32(0); i < count; i++ {
		idLen, err := readUvarint(r)
		if err != nil {
			return nil, err
		}
		idBytes := make([]byte, idLen)
		if _, err := io.ReadFull(r, idBytes); err != nil {
			return nil, err
		}
		jsonLen, err := readUvarint(r)
		if err != nil {
			return nil, err
		}
		jsonBytes := make([]byte, jsonLen)
		if _, err := io.ReadFull(r, jsonBytes); err != nil {
			return nil, err
		}
		src, err := jsonUnmarshal(jsonBytes)
		if err != nil {
			return nil, err
		}
		s.docs = append(s.docs, SegmentDoc{ID: string(idBytes), Source: src})
	}
	return s, nil
}

// --- codec helpers (json + vint), kept tiny for chapter 11 -----------------

func jsonMarshal(src map[string]any) ([]byte, error) {
	return json.Marshal(src)
}

func jsonUnmarshal(b []byte) (map[string]any, error) {
	var m map[string]any
	if err := json.Unmarshal(b, &m); err != nil {
		return nil, fmt.Errorf("decode doc json: %w", err)
	}
	return m, nil
}

func writeUvarint(buf *bytes.Buffer, n int) {
	var tmp [binary.MaxVarintLen64]byte
	written := binary.PutUvarint(tmp[:], uint64(n))
	buf.Write(tmp[:written])
}

func readUvarint(r *bytes.Reader) (int, error) {
	v, err := binary.ReadUvarint(r)
	if err != nil {
		return 0, err
	}
	return int(v), nil
}

// --- store -----------------------------------------------------------------

// Store manages the on-disk layout: append-only segment files plus a
// tombstone list for deleted ids.
type Store struct {
	dir        string
	segments   []*Segment
	tombstones map[string]bool
	nextID     int
}

// OpenStore loads all valid segments from dir, replaying them in name order.
// Corrupt files are quarantined, not fatal - recovery continues with what is
// readable.
func OpenStore(dir string) (*Store, error) {
	st := &Store{dir: dir, tombstones: make(map[string]bool)}
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return st, os.MkdirAll(dir, 0o755)
	}
	if err != nil {
		return nil, err
	}
	var names []string
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".seg") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	for _, name := range names {
		data, err := os.ReadFile(filepath.Join(dir, name))
		if err != nil {
			continue
		}
		seg, err := Decode(data)
		if err != nil {
			quarantine := filepath.Join(dir, name+".corrupt")
			os.Rename(filepath.Join(dir, name), quarantine)
			continue
		}
		seg.Name = name
		st.segments = append(st.segments, seg)
		st.nextID++
	}
	return st, nil
}

// Index appends documents as a fresh segment file. fsync happens before the
// call returns: once acknowledged, the bytes are on disk.
func (st *Store) Index(docs []model.Document) error {
	st.nextID++
	name := fmt.Sprintf("seg-%06d.seg", st.nextID)
	seg := NewSegment(name, docs)
	data, err := seg.Encode()
	if err != nil {
		return err
	}
	path := filepath.Join(st.dir, name)
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0o644)
	if err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	st.segments = append(st.segments, seg)
	return nil
}

// Delete records a tombstone. Postings for the id remain in old segments
// until a merge rewrites them - exactly book chapter 23.
func (st *Store) Delete(id string) bool {
	if st.tombstones[id] {
		return false
	}
	st.tombstones[id] = true
	return true
}

// Tombstones exposes the current tombstone set.
func (st *Store) Tombstones() map[string]bool {
	out := make(map[string]bool, len(st.tombstones))
	for k := range st.tombstones {
		out[k] = true
	}
	return out
}

// AllDocs replays every segment in order, applying tombstones.
func (st *Store) AllDocs() []model.Document {
	seen := make(map[string]int)
	var docs []model.Document
	for _, seg := range st.segments {
		for _, d := range seg.Docs() {
			if i, ok := seen[d.ID]; ok {
				docs[i] = model.Document{ID: d.ID, Source: d.Source} // newer overwrites older
				continue
			}
			seen[d.ID] = len(docs)
			docs = append(docs, model.Document{ID: d.ID, Source: d.Source})
		}
	}
	out := docs[:0]
	for _, d := range docs {
		if !st.tombstones[d.ID] {
			out = append(out, d)
		}
	}
	return out
}

// Merge rewrites live documents into one compacted segment and removes the
// originals - the moment tombstones finally disappear.
func (st *Store) Merge() error {
	live := st.AllDocs()
	for _, seg := range st.segments {
		os.Remove(filepath.Join(st.dir, seg.Name))
	}
	st.segments = nil
	st.nextID = 0
	return st.Index(live)
}

// SegmentCount reports how many segment files exist.
func (st *Store) SegmentCount() int { return len(st.segments) }
