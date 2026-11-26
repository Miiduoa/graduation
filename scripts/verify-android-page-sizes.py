#!/usr/bin/env python3
"""Verify Android 16 KiB native library alignment in an APK or an App Bundle."""
import argparse
import json
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tempfile
import zipfile


PAGE = 16 * 1024
MACHINES = {"arm64-v8a": 183, "x86_64": 62, "riscv64": 243, "mips64": 8}
ELF_HEADER = struct.Struct("<16sHHIQQQIHHHHHH")
PROGRAM_HEADER = struct.Struct("<IIQQQQQQ")
LOCAL_HEADER = struct.Struct("<4s5H3I2H")


def verify_elf(stream, size, abi):
    raw = stream.read(ELF_HEADER.size)
    if len(raw) != ELF_HEADER.size:
        raise ValueError("truncated ELF header")
    header = ELF_HEADER.unpack(raw)
    ident, kind, machine = header[:3]
    if ident[:7] != b"\x7fELF\x02\x01\x01" or kind != 3 or machine != MACHINES[abi]:
        raise ValueError(f"expected a little-endian ELF64 shared library for {abi}")
    offset, stride, count = header[5], header[9], header[10]
    if (offset < ELF_HEADER.size or stride < PROGRAM_HEADER.size or count == 0
            or offset + stride * count > size):
        raise ValueError("invalid ELF program header table")
    stream.seek(offset)
    loads = []
    relro_ends = []
    for _ in range(count):
        kind, flags, file_offset, address, _, file_size, memory_size, alignment = (
            PROGRAM_HEADER.unpack(stream.read(stride)[:PROGRAM_HEADER.size])
        )
        if kind == 0x6474E552:  # PT_GNU_RELRO
            relro_ends.append(address + memory_size)
        if kind != 1:  # PT_LOAD
            continue
        if file_offset + file_size > size or memory_size < file_size:
            raise ValueError("invalid PT_LOAD range")
        if alignment < PAGE or alignment & (alignment - 1):
            raise ValueError(f"PT_LOAD p_align={alignment:#x}, need a power of two >= 0x4000")
        if (address - file_offset) % alignment:
            raise ValueError(
                f"PT_LOAD p_offset={file_offset:#x} and p_vaddr={address:#x} disagree modulo p_align"
            )
        loads.append((address, address + memory_size, flags))
    if not loads:
        raise ValueError("no PT_LOAD segments")
    # The linker protects whole pages. Padding after RELRO is safe unless writable data shares its page.
    for end in relro_ends:
        page_end = (end + PAGE - 1) // PAGE * PAGE
        if any(flags & 2 and max(start, end) < min(stop, page_end) for start, stop, flags in loads):
            raise ValueError(f"writable PT_LOAD data shares the trailing 16 KiB GNU_RELRO page at {end:#x}")


def verify_zip_offset(archive, entry):
    # The local header can differ from the central directory (especially its padding extra field).
    archive.fp.seek(entry.header_offset)
    header = LOCAL_HEADER.unpack(archive.fp.read(LOCAL_HEADER.size))
    if header[0] != b"PK\x03\x04":
        raise ValueError("invalid ZIP local header")
    data_offset = entry.header_offset + LOCAL_HEADER.size + header[-2] + header[-1]
    if data_offset % PAGE:
        raise ValueError(f"uncompressed .so at ZIP offset {data_offset:#x} is not 16 KiB aligned")


def verify_archive(archive, bundle=False):
    pattern = r"[^/]+/lib/([^/]+)/([^/]+\.so)" if bundle else r"lib/([^/]+)/([^/]+\.so)"
    verified = set()
    paths = set()
    for entry in archive.infolist():
        match = re.fullmatch(pattern, entry.filename)
        if not match:
            continue
        abi, library = match.groups()
        try:
            if entry.filename in paths:
                raise ValueError("duplicate library path")
            paths.add(entry.filename)
            if not bundle and entry.compress_type == zipfile.ZIP_STORED:
                verify_zip_offset(archive, entry)
            if abi not in MACHINES:
                if "64" in abi:
                    raise ValueError(f"unknown 64-bit ABI {abi}")
                continue
            with archive.open(entry) as stream:
                verify_elf(stream, entry.file_size, abi)
            verified.add((abi, library, entry.file_size, entry.CRC))
        except (ValueError, struct.error) as exc:
            raise ValueError(f"{entry.filename}: {exc}") from exc
    return verified


def verify_bundle_config(config):
    native = config.get("optimizations", {}).get("uncompressNativeLibraries", {})
    # PAGE_ALIGNMENT_64K also satisfies the 16 KiB requirement.
    if native.get("alignment") not in {"PAGE_ALIGNMENT_16K", "PAGE_ALIGNMENT_64K"}:
        raise ValueError("BundleConfig must request PAGE_ALIGNMENT_16K or PAGE_ALIGNMENT_64K")


def verify_generated_apks(apks_file, expected):
    verified = set()
    with zipfile.ZipFile(apks_file) as splits:
        for entry in splits.infolist():
            if not entry.filename.endswith(".apk"):
                continue
            # Inspect default Play splits (including feature modules) and standalones, one APK at a time.
            with tempfile.TemporaryFile() as apk:
                with splits.open(entry) as src:
                    shutil.copyfileobj(src, apk)
                try:
                    with zipfile.ZipFile(apk) as archive:
                        verified.update(verify_archive(archive))
                except (ValueError, zipfile.BadZipFile) as exc:
                    raise ValueError(f"{entry.filename}: {exc}") from exc
    if verified != expected:
        raise ValueError("bundletool-generated APKs do not contain the verified set of 64-bit libraries")


def verify_artifact(artifact, bundletool=None):
    bundle = artifact.suffix.lower() == ".aab"
    if not bundle and artifact.suffix.lower() != ".apk":
        raise ValueError("expected an .apk or .aab archive")
    with zipfile.ZipFile(artifact) as archive:
        marker = "BundleConfig.pb" if bundle else "AndroidManifest.xml"
        if marker not in archive.namelist():
            raise ValueError(f"expected {marker} in {artifact.name}")
        libraries = verify_archive(archive, bundle)
    if not libraries:
        raise ValueError("no packaged 64-bit native libraries")
    if bundle:
        if not bundletool:
            raise ValueError("provide the bundletool JAR with --bundletool to verify an AAB")
        java = ["java", "-jar", str(bundletool)]
        config = subprocess.check_output([*java, "dump", "config", f"--bundle={artifact}"])
        verify_bundle_config(json.loads(config))
        with tempfile.TemporaryDirectory() as directory:
            apks = Path(directory) / "release.apks"
            subprocess.run([*java, "build-apks", f"--bundle={artifact}", f"--output={apks}"], check=True)
            verify_generated_apks(apks, libraries)
    return libraries


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("artifact", type=Path)
    parser.add_argument("--bundletool", type=Path)
    args = parser.parse_args()
    try:
        libraries = verify_artifact(args.artifact, args.bundletool)
    except (OSError, ValueError, struct.error, zipfile.BadZipFile, subprocess.CalledProcessError) as exc:
        parser.exit(1, f"Android page-size verification failed: {exc}\n")
    abis = ", ".join(sorted({entry[0] for entry in libraries}))
    print(
        f"Verified 16 KiB ELF and APK ZIP alignment for {len(libraries)} "
        f"native libraries ({abis}) in {args.artifact.name}."
    )


if __name__ == "__main__":
    main()
