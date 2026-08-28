# Chapter 11 — Segments: Bytes, Checksums, Tombstones, Merges

Everything so far lives in memory. A restart must not lose it. Seeker's storage model is Lucene's, simplified to its essence: **immutable segment files + tombstones + merges**.

> Code: `internal/segment/segment.go`

## The byte format

```go
//	magic "SKR1" | version u16 | docCount u32
//	  per doc: idLen vint | id bytes | jsonLen vint | json bytes
//	crc32 of everything above | footer magic
var (
	Magic   = []byte{'S', 'K', 'R', '1'}
	Version = uint16(1)
)
```

Lengths are `uvarint`s (1 byte for short strings, not 8 for a fixed u64), documents are stored as their JSON `_source`, and the footer repeats the magic so a truncated tail is detectable even where a CRC collision wouldn't be.

## Decode: integrity before parsing

This ordering was a real bug fix. The first draft parsed header lengths *first* and checked the checksum after — meaning a flipped bit in `docCount` could send the reader marching off the buffer with a huge allocation before integrity was ever verified:

```go
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
```

Only after CRC and footer pass does a single length get trusted. The test feeds truncated and bit-flipped buffers and expects clean errors, never panics.

## Durable writes

```go
f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_EXCL, 0o644)
...
if err := f.Sync(); err != nil { ... }
```

`O_EXCL` makes segment names write-once (immutability enforced by the OS), and `Sync()` returns only once bytes hit disk — "acknowledged means durable."

## Recovery: quarantine, don't die

```go
seg, err := Decode(data)
if err != nil {
	quarantine := filepath.Join(dir, name+".corrupt")
	os.Rename(filepath.Join(dir, name), quarantine)
	continue
}
```

`OpenStore` replays `*.seg` files in name order; unreadable ones are renamed aside and startup continues. One bad file from a crashed write must not take down every restart forever.

## Deletes are tombstones

```go
func (st *Store) Delete(id string) bool {
	if st.tombstones[id] {
		return false
	}
	st.tombstones[id] = true
	return true
}
```

Nothing is removed — segments are immutable. `AllDocs` replays segments in order (**newer overwrites older** on duplicate ids) then filters tombstones. That's why re-indexing `doc-5` works: last write wins at read time, and chapter 12's engine rebuilds in-memory indexes from this replay.

## Merge reclaims space

```go
func (st *Store) Merge() error {
	live := st.AllDocs()
	for _, seg := range st.segments {
		os.Remove(filepath.Join(st.dir, seg.Name))
	}
	st.segments = nil
	st.nextID = 0
	return st.Index(live)
}
```

Rewrite live docs into one fresh segment, delete the originals — the moment tombstoned postings finally disappear. Production engines do this continuously in the background with tiered policies; the concept fits in ten lines.

Next: putting an HTTP face on all of it.
