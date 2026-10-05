import { createFileRoute } from '@tanstack/react-router';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { ToggleGroup, ToggleGroupItem } from '../components/ui/toggle-group';

export const Route = createFileRoute('/app/settings/appearance')({
  component: AppearanceSettings,
});

function AppearanceSettings() {
  const { theme = 'system', setTheme } = useTheme();

  return (
    <div className="mx-auto grid w-full max-w-4xl gap-10 px-5 py-10 md:px-10 md:py-12">
      <header>
        <h1 className="font-semibold text-3xl tracking-tight">Appearance</h1>
      </header>
      <section className="grid gap-4" aria-labelledby="theme-heading">
        <div className="grid gap-1">
          <h2 id="theme-heading" className="font-semibold text-xl">
            Theme
          </h2>
          <p id="theme-description" className="text-muted-foreground text-sm">
            Choose a theme or follow your system’s appearance. Your choice is saved in this browser.
          </p>
        </div>
        <ToggleGroup
          aria-labelledby="theme-heading"
          aria-describedby="theme-description"
          variant="outline"
          spacing={0}
          value={[theme]}
          onValueChange={(values) => {
            const selected = values[0];
            if (selected) {
              setTheme(selected);
            }
          }}
        >
          <ToggleGroupItem value="system">
            <Monitor aria-hidden="true" />
            System
          </ToggleGroupItem>
          <ToggleGroupItem value="light">
            <Sun aria-hidden="true" />
            Light
          </ToggleGroupItem>
          <ToggleGroupItem value="dark">
            <Moon aria-hidden="true" />
            Dark
          </ToggleGroupItem>
        </ToggleGroup>
      </section>
    </div>
  );
}
