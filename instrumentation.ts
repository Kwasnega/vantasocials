import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchLogRecordProcessor, LoggerProvider } from "@opentelemetry/sdk-logs";

const projectToken = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

function reportMissingConfiguration() {
  if (process.env.NODE_ENV !== "development") return;

  if (!projectToken) {
    console.error(
      new Error(
        "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is configured",
      ),
    );
  }

  if (!host) {
    console.error(
      new Error(
        "NEXT_PUBLIC_POSTHOG_HOST variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_HOST is configured",
      ),
    );
  }
}

export const postHogLogProvider = projectToken && host
  ? new LoggerProvider({
      resource: resourceFromAttributes({ "service.name": "vanta-nextjs" }),
      processors: [
        new BatchLogRecordProcessor({
          exporter: new OTLPLogExporter({
            url: `${host.replace(/\/$/, "")}/i/v1/logs`,
            headers: {
              Authorization: `Bearer ${projectToken}`,
              "Content-Type": "application/json",
            },
          }),
        }),
      ],
    })
  : null;

export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && postHogLogProvider) {
    logs.setGlobalLoggerProvider(postHogLogProvider);
  } else if (!postHogLogProvider) {
    reportMissingConfiguration();
  }
}

const postHogLogger = postHogLogProvider?.getLogger("vanta-posthog-logs");

type PostHogLogAttributes = Record<string, string | number | boolean>;

export function emitPostHogLog(
  body: string,
  severityNumber: SeverityNumber,
  attributes: PostHogLogAttributes,
) {
  postHogLogger?.emit({ body, severityNumber, attributes });
}

export async function flushPostHogLogs() {
  await postHogLogProvider?.forceFlush();
}

export { SeverityNumber };
