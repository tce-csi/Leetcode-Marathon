import { Toaster } from "sonner";
import { SessionProvider } from "@/components/session-provider";
import { ThemeProvider, useTheme } from "@/components/theme-provider";

function ThemedToaster() {
  const { theme } = useTheme();
  return (
    <Toaster
      theme={theme}
      position="top-center"
      closeButton
      toastOptions={{
        style: {
          background: "var(--color-surface)",
          border: "1px solid var(--color-border)",
          color: "var(--color-foreground)",
        },
      }}
    />
  );
}

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <SessionProvider>
        {children}
        <ThemedToaster />
      </SessionProvider>
    </ThemeProvider>
  );
}
