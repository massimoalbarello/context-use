import { createContext, type MouseEvent, useContext } from 'react';
import type { ResourceSelection } from '../../lib/resource-selection';

export const ResourceNavigation = createContext<{
  selection?: ResourceSelection;
  onSelect: (selection: ResourceSelection) => void;
} | null>(null);

export function useResourceLink(selection: ResourceSelection) {
  const navigation = useContext(ResourceNavigation);
  return {
    selected: navigation
      ? navigation.selection?.kind === selection.kind &&
        navigation.selection?.readableId === selection.readableId
      : undefined,
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      if (
        !navigation ||
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      navigation.onSelect(selection);
    },
  };
}
