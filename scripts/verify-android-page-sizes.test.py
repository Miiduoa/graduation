import importlib.util
from io import BytesIO
from pathlib import Path
import struct
import tempfile
import unittest
import zipfile


spec = importlib.util.spec_from_file_location(
    "page_sizes", Path(__file__).with_name("verify-android-page-sizes.py")
)
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)
ARM = "lib/arm64-v8a/libarm.so"
X86 = "lib/x86_64/libx86.so"


def segment(kind=1, flags=5, offset=0, address=0, size=0x180, alignment=0x4000):
    return (kind, flags, offset, address, address, size, size, alignment)


def elf(machine=183, segments=None):
    segments = segments or [segment()]
    header = gate.ELF_HEADER.pack(
        b"\x7fELF\x02\x01\x01", 3, machine, 1, 0, gate.ELF_HEADER.size, 0, 0,
        gate.ELF_HEADER.size, gate.PROGRAM_HEADER.size, len(segments), 0, 0, 0,
    )
    data = header + b"".join(gate.PROGRAM_HEADER.pack(*item) for item in segments)
    return data.ljust(max(item[2] + item[5] for item in segments), b"\0")


def archive(entries, marker="AndroidManifest.xml"):
    output = BytesIO()
    with zipfile.ZipFile(output, "w") as package:
        package.writestr(marker, b"")
        for name, content, packing in entries:
            entry = zipfile.ZipInfo(name)
            if packing == "aligned":
                # Only the ZIP local header has the Android padding. The directory intentionally doesn't.
                padding = -(output.tell() + 30 + len(name.encode())) % 16384
                if 0 < padding < 4:
                    padding += 16384
                if padding:
                    entry.extra = struct.pack("<HH", 0xCAFE, padding - 4) + bytes(padding - 4)
            elif packing == "compressed":
                entry.compress_type = zipfile.ZIP_DEFLATED
            package.writestr(entry, content)
            entry.extra = b""
    return output.getvalue()


def splits(*apks):
    output = BytesIO()
    with zipfile.ZipFile(output, "w") as package:
        for name, apk in apks:
            package.writestr(name, apk)
    output.seek(0)
    return output


class AndroidPageSizeTests(unittest.TestCase):
    def verify_apk(self, *entries):
        with tempfile.TemporaryDirectory() as directory:
            apk = Path(directory) / "release.apk"
            apk.write_bytes(archive(entries))
            return gate.verify_artifact(apk)

    def test_stored_and_compressed_64_bit_libraries(self):
        library = elf(segments=[segment(), segment(offset=0x123, address=0x4123, alignment=0x4000)])
        verified = self.verify_apk((ARM, library, "aligned"), (X86, elf(machine=62), "compressed"))
        self.assertEqual({(abi, name) for abi, name, _, _ in verified}, {
            ("arm64-v8a", "libarm.so"), ("x86_64", "libx86.so"),
        })

    def test_all_load_segments_and_abis_are_checked_even_if_compressed(self):
        for alignment in (0x1000, 0x6000):
            library = elf(machine=62, segments=[segment(), segment(alignment=alignment)])
            with self.subTest(alignment=alignment):
                with self.assertRaisesRegex(ValueError, r"x86_64/libx86.so: PT_LOAD p_align"):
                    self.verify_apk((ARM, elf(), "aligned"), (X86, library, "compressed"))

    def test_mismatched_file_and_virtual_page_offsets(self):
        with self.assertRaisesRegex(ValueError, "disagree modulo"):
            self.verify_apk((ARM, elf(segments=[segment(offset=0x100, address=0x4200)]), "aligned"))

    def test_a_stored_library_needs_a_page_aligned_zip_offset(self):
        with self.assertRaisesRegex(ValueError, "ZIP offset"):
            self.verify_apk((ARM, elf(), "unaligned"))

    def test_bad_elf_or_missing_64_bit_libraries(self):
        for content in (b"truncated", bytes(128), elf(machine=62), elf(segments=[segment(kind=2)])):
            with self.subTest(content=content[:24]), self.assertRaises(ValueError):
                self.verify_apk((ARM, content, "compressed"))
        with self.assertRaisesRegex(ValueError, "no packaged 64-bit"):
            self.verify_apk(("lib/armeabi-v7a/liblegacy.so", b"legacy", "compressed"))

    def test_relro_must_leave_adjacent_writable_data_writable(self):
        relro = segment(kind=0x6474E552, flags=4, offset=0x200, address=0x4200, size=0x100)
        load = segment(flags=6, offset=0x200, address=0x4200, size=0x200)
        with self.assertRaisesRegex(ValueError, "trailing 16 KiB GNU_RELRO"):
            self.verify_apk((ARM, elf(segments=[segment(), load, relro]), "compressed"))
        # A RELRO region ending in the middle of a page is safe if the next writable data is on another page.
        following = segment(flags=6, offset=0x400, address=0x8400)
        load = segment(flags=6, offset=0x200, address=0x4200, size=0x100)
        self.verify_apk((ARM, elf(segments=[segment(), load, relro, following]), "compressed"))

    def test_bundle_config_must_request_compatible_alignment(self):
        for alignment in ("PAGE_ALIGNMENT_16K", "PAGE_ALIGNMENT_64K"):
            native = {"alignment": alignment}
            gate.verify_bundle_config({"optimizations": {"uncompressNativeLibraries": native}})
        for native in ({}, {"alignment": "PAGE_ALIGNMENT_4K"}):
            with self.assertRaisesRegex(ValueError, "BundleConfig"):
                gate.verify_bundle_config({"optimizations": {"uncompressNativeLibraries": native}})

    def test_aab_offsets_are_irrelevant_but_every_generated_split_must_pass(self):
        arm = elf()
        x86 = elf(machine=62)
        entries = [("base/" + ARM, arm, "unaligned"), ("feature/" + X86, x86, "unaligned")]
        aab = archive(entries, "BundleConfig.pb")
        with zipfile.ZipFile(BytesIO(aab)) as bundle:
            expected = gate.verify_archive(bundle, bundle=True)
        self.assertEqual(len(expected), 2)
        base = ("splits/base-arm64.apk", archive([(ARM, arm, "aligned")]))
        feature = ("splits/feature-x86.apk", archive([(X86, x86, "aligned")]))
        gate.verify_generated_apks(splits(base, feature), expected)
        with self.assertRaisesRegex(ValueError, "do not contain"):
            gate.verify_generated_apks(splits(base), expected)
        broken = ("splits/broken-x86.apk", archive([(X86, x86, "unaligned")]))
        with self.assertRaisesRegex(ValueError, "broken-x86.apk:.*ZIP offset"):
            gate.verify_generated_apks(splits(base, feature, broken), expected)


if __name__ == "__main__":
    unittest.main()
