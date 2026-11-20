export const pagesQueryKey = ['mcp-pages'] as const;
export const pageQueryKey = (address: string) => ['mcp-page', address] as const;
