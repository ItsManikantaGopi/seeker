package segment

import (
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"kaus-go/internal/model"
)

func writeFile(path string, data []byte) error {
	return os.WriteFile(path, data, 0o644)
}

func statFile(path string) (os.FileInfo, error) {
	return os.Stat(path)
}

func mkDocs(t *testing.T) []model.Document {
	t.Helper()
	var out []model.Document
	for i := 0; i < 3; i++ {
		d, err := model.NewDocument(
			"doc-"+string(rune('a'+i)),
			map[string]any{"id": "doc-" + string(rune('a'+i)), "title": "t", "n": float64(i)},
		)
		if err != nil {
			t.Fatal(err)
		}
		out = append(out, *d)
	}
	return out
}

func TestEncodeDecodeRoundTrip(t *testing.T) {
	seg := NewSegment("s1", mkDocs(t))
	data, err := seg.Encode()
	if err != nil {
		t.Fatal(err)
	}
	back, err := Decode(data)
	if err != nil {
		t.Fatal(err)
	}
	if len(back.Docs()) != 3 {
		t.Fatalf("decoded %d docs", len(back.Docs()))
	}
	if back.Docs()[1].ID != "doc-b" || back.Docs()[1].Source["n"].(float64) != 1 {
		t.Errorf("payload mismatch: %+v", back.Docs()[1])
	}
}

func TestDecodeDetectsCorruption(t *testing.T) {
	data, err := NewSegment("s", mkDocs(t)).Encode()
	if err != nil {
		t.Fatal(err)
	}

	// Flip one payload byte: the CRC must catch it.
	corrupt := append([]byte(nil), data...)
	corrupt[10] ^= 0xFF
	if _, err := Decode(corrupt); !errors.Is(err, ErrChecksum) {
		t.Fatalf("flipped byte error = %v, want ErrChecksum", err)
	}

	// Truncation must fail too (footer magic gone).
	if _, err := Decode(data[:len(data)-3]); err == nil {
		t.Fatal("truncated segment decoded without error")
	}

	// Wrong magic.
	bad := append([]byte(nil), data...)
	bad[0] = 'X'
	if _, err := Decode(bad); err == nil {
		t.Fatal("bad magic accepted")
	}
}

func TestStoreLifecycle(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "data")

	st, err := OpenStore(dir) // creates the directory
	if err != nil {
		t.Fatal(err)
	}
	if err := st.Index(mkDocs(t)); err != nil {
		t.Fatal(err)
	}
	if err := st.Index(mkDocs(t)[:1]); err != nil { // doc-a again (upsert)
		t.Fatal(err)
	}
	if st.SegmentCount() != 2 {
		t.Fatalf("segments = %d, want 2", st.SegmentCount())
	}

	// Reopen from disk: replay must restore everything.
	st2, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	live := st2.AllDocs()
	if len(live) != 3 {
		t.Fatalf("replayed docs = %d, want 3", len(live))
	}

	// Tombstone hides a doc until merge.
	if !st2.Delete("doc-c") {
		t.Fatal("delete failed")
	}
	live = st2.AllDocs()
	if len(live) != 2 {
		t.Fatalf("post-tombstone docs = %d, want 2", len(live))
	}

	if err := st2.Merge(); err != nil {
		t.Fatal(err)
	}
	if st2.SegmentCount() != 1 {
		t.Fatalf("after merge segments = %d, want 1", st2.SegmentCount())
	}
	live = st2.AllDocs()
	if len(live) != 2 || live[0].ID != "doc-a" {
		t.Fatalf("merged docs = %+v", live)
	}

	// The merged file must itself be loadable.
	st3, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if got := len(st3.AllDocs()); got != 2 {
		t.Fatalf("reload after merge = %d docs, want 2", got)
	}
}

func TestOpenStoreQuarantinesCorruptFile(t *testing.T) {
	dir := t.TempDir()

	good, err := NewSegment("seg-000001.seg", mkDocs(t)).Encode()
	if err != nil {
		t.Fatal(err)
	}
	if err := writeFile(filepath.Join(dir, "seg-000001.seg"), good); err != nil {
		t.Fatal(err)
	}
	junk := []byte("this is not a segment")
	if err := writeFile(filepath.Join(dir, "seg-000002.seg"), junk); err != nil {
		t.Fatal(err)
	}

	st, err := OpenStore(dir)
	if err != nil {
		t.Fatal(err)
	}
	if st.SegmentCount() != 1 {
		t.Fatalf("valid segments = %d, want 1", st.SegmentCount())
	}
	if _, err := statFile(filepath.Join(dir, "seg-000002.seg.corrupt")); err != nil {
		t.Fatalf("corrupt file not quarantined: %v", err)
	}
	if _, err := statFile(filepath.Join(dir, "seg-000002.seg")); err == nil {
		t.Fatal("quarantined original still in place")
	}
	if !reflect.DeepEqual(st.AllDocs()[0].Source["title"], "t") {
		t.Error("surviving segment payload wrong")
	}
}
