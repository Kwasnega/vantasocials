import "server-only";

import {
  emitPostHogLog,
  flushPostHogLogs,
  SeverityNumber,
} from "../../instrumentation";

type PostHogLogAttributes = Record<string, string | number | boolean>;

export function logPostHogInfo(body: string, attributes: PostHogLogAttributes) {
  emitPostHogLog(body, SeverityNumber.INFO, attributes);
}

export function logPostHogError(body: string, attributes: PostHogLogAttributes) {
  emitPostHogLog(body, SeverityNumber.ERROR, attributes);
}

export { flushPostHogLogs };
