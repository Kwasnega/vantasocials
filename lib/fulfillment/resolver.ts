import "server-only";

import { resolveActiveMapping } from "./mapping";
import { ReliableSMMAdapter } from "./reliablesmm/adapter";

export function resolveProviderForService(vantaSlug: string) {
  const mapping = resolveActiveMapping(vantaSlug);
  if (!mapping) return null;
  if (mapping.provider === "reliablesmm") return { mapping, adapter: new ReliableSMMAdapter() };
  return null;
}
