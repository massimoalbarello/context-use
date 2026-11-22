export const searchQueryKey = ['mcp-search'] as const;
export const resourceQueryKey = (address: string) => ['mcp-resource', address] as const;
