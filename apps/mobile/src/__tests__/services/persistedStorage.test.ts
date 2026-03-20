import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  loadPersistedValue,
  removePersistedValue,
  savePersistedValue,
} from "../../services/persistedStorage";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

describe("persistedStorage", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it("loads the primary key when present", async () => {
    await AsyncStorage.setItem("primary", JSON.stringify({ value: 1 }));
    await AsyncStorage.setItem("legacy", JSON.stringify({ value: 2 }));

    const result = await loadPersistedValue({
      storageKey: "primary",
      legacyKeys: ["legacy"],
      fallback: { value: 0 },
    });

    expect(result).toEqual({ value: 1 });
  });

  it("falls back to a legacy key when the primary key is missing", async () => {
    await AsyncStorage.setItem("legacy", JSON.stringify({ value: 2 }));

    const result = await loadPersistedValue({
      storageKey: "primary",
      legacyKeys: ["legacy"],
      fallback: { value: 0 },
    });

    expect(result).toEqual({ value: 2 });
  });

  it("returns the fallback when persisted data is invalid", async () => {
    await AsyncStorage.setItem("primary", "not-json");

    const result = await loadPersistedValue({
      storageKey: "primary",
      fallback: { value: 0 },
    });

    expect(result).toEqual({ value: 0 });
  });

  it("saves and removes persisted values", async () => {
    await savePersistedValue("primary", { value: 3 });
    expect(await AsyncStorage.getItem("primary")).toBe(JSON.stringify({ value: 3 }));

    await removePersistedValue("primary");
    expect(await AsyncStorage.getItem("primary")).toBeNull();
  });
});
