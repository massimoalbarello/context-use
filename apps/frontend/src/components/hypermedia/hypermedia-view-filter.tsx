import type { HypermediaView } from '../../queries/hypermedia';
import { Tabs, TabsList, TabsTrigger } from '../ui/tabs';

export function HypermediaViewFilter({
  value,
  onValueChange,
}: {
  value: HypermediaView;
  onValueChange: (value: HypermediaView) => void;
}) {
  return (
    <div className="grid gap-2">
      <p id="hypermedia-view-label" className="font-medium text-xs">
        View
      </p>
      <Tabs
        value={value}
        onValueChange={(nextValue) => {
          if (nextValue === 'map' || nextValue === 'timeline') {
            onValueChange(nextValue);
          }
        }}
      >
        <TabsList className="grid w-full grid-cols-2" aria-labelledby="hypermedia-view-label">
          <TabsTrigger value="map">Map</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
