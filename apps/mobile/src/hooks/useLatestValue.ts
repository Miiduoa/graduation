import { useEffect, useRef, useState } from "react";

export function useLatestValue<T>(value: T) {
  const ref = useRef(value);

  useEffect(() => {
    ref.current = value;
  }, [value]);

  return ref;
}

export function useConstant<T>(factory: () => T): T {
  const [value] = useState(factory);
  return value;
}
