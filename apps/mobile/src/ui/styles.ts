import { theme } from "./theme";

export const styles = {
  text: {
    title: { fontSize: 22, fontWeight: "800", color: theme.colors.text } as const,
    h2: { fontSize: 16, fontWeight: "800", color: theme.colors.text } as const,
    body: { fontSize: 14, color: theme.colors.text } as const,
    muted: { fontSize: 13, color: theme.colors.muted } as const,
  },
};
