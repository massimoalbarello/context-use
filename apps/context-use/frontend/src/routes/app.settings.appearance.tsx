import { Button } from '@repo/ui/button';
import { createFileRoute } from '@tanstack/react-router';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

const themeOptions = [
  { value: 'system', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
];

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
        <fieldset
          className="flex flex-wrap gap-1"
          aria-labelledby="theme-heading"
          aria-describedby="theme-description"
        >
          {themeOptions.map((option) => (
            <Button
              key={option.value}
              type="button"
              variant={theme === option.value ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={theme === option.value}
              onClick={() => setTheme(option.value)}
            >
              <option.icon aria-hidden="true" />
              {option.label}
            </Button>
          ))}
        </fieldset>
      </section>
    </div>
  );
}
