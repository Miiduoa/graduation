package com.rnllama;

public final class Arm64LibrarySelectorTest {
    private static final String BASE = "rnllama_v8";
    private static final String FP16 = "rnllama_v8_2_fp16";
    private static final String DOT = "rnllama_v8_2_fp16_dotprod";
    private static final String FML = "rnllama_v8_4_fp16_dotprod";
    private static final String SVE = "rnllama_v8_4_fp16_dotprod_sve";
    private static final String I8MM = "rnllama_v8_4_fp16_dotprod_i8mm";
    private static final String SVE_I8MM = "rnllama_v8_4_fp16_dotprod_i8mm_sve";

    // /proc/cpuinfo from the Android 16 ARM64 16 KiB emulator that crashed in model initialization.
    private static final String EMULATOR_FEATURES =
            "Features\t: fp asimd evtstrm aes pmull sha1 sha2 crc32 atomics fphp asimdhp cpuid "
            + "asimdrdm jscvt fcma lrcpc dcpop sha3 asimddp sha512 asimdfhm dit uscat ilrcpc "
            + "flagm sb paca pacg dcpodp sve2 flagm2 frint svei8mm svebf16 bf16 afp ebf16 "
            + "sveebf16 sve2p1";

    private static void check(String name, String features, String expected) {
        String actual = Arm64LibrarySelector.select(features);
        if (!expected.equals(actual)) {
            throw new AssertionError(name + ": expected " + expected + ", got " + actual);
        }
    }

    public static void main(String[] args) {
        String half = "fphp asimdhp";
        String dot = half + " asimddp";
        String fml = dot + " asimdfhm";

        check("Android 16 emulator", EMULATOR_FEATURES, FML);
        check("unavailable cpuinfo", "", BASE);
        check("empty feature list", "Features\t:  ", BASE);
        check("basic arm64", "Features\t: fp asimd aes crc32", BASE);
        check("scalar half precision alone", "fphp asimddp asimdfhm", BASE);
        check("vector half precision alone", "asimdhp asimddp asimdfhm", BASE);
        check("partial and noncanonical names", "fp16 asimdhp2 dotprod", BASE);
        check("scalar and vector half precision", half, FP16);
        check("dot product missing", half + " asimdfhm sve i8mm svei8mm", FP16);
        check("half precision dot product", dot, DOT);
        check("FP16 FML missing", dot + " sve i8mm svei8mm", DOT);
        check("FP16 FML dot product", fml, FML);
        check("SVE extensions without base SVE or I8MM", fml + " sve2 svei8mm", FML);
        check("SVE alone", fml + " sve", SVE);
        check("I8MM alone", fml + " i8mm", I8MM);
        check("SVE I8MM missing", fml + " sve i8mm", SVE);
        check("Advanced SIMD I8MM missing", fml + " sve svei8mm", SVE);
        check("base SVE missing", fml + " i8mm svei8mm", I8MM);
        check("all matrix extensions in mixed order",
                "Features\t: svei8mm\tasimdfhm  i8mm asimdhp sve asimddp fphp", SVE_I8MM);
        System.out.println("Android ARM64 llama library selection passed.");
    }
}
