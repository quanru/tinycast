export function collect(shard?: string): Promise<Array<{
  id: string;
  title: string;
  shard: string;
}>>;
