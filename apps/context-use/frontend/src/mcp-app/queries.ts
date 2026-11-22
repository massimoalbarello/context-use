export const pagesQueryKey = ['mcp-pages'] as const;
export const pageQueryKey = (address: string | undefined) => ['mcp-page', address] as const;
