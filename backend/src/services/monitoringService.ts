import os from "node:os";

type RouteMetric = {
  errors: number;
  requests: number;
  totalDurationMs: number;
};

const startedAt = new Date();
const routeMetrics = new Map<string, RouteMetric>();
const MAX_ROUTE_METRICS = 500;

export function recordHttpRequest(input: {
  durationMs: number;
  method: string;
  path: string;
  statusCode: number;
}) {
  const key = `${input.method.toUpperCase()} ${normalizePath(input.path)}`;
  const metric = routeMetrics.get(key) ?? {
    errors: 0,
    requests: 0,
    totalDurationMs: 0
  };

  metric.requests += 1;
  metric.totalDurationMs += input.durationMs;

  if (input.statusCode >= 500) {
    metric.errors += 1;
  }

  routeMetrics.set(key, metric);

  if (routeMetrics.size > MAX_ROUTE_METRICS) {
    pruneRouteMetrics();
  }
}

export function metricsSnapshot() {
  const memory = process.memoryUsage();
  const cpu = process.cpuUsage();
  const routes = [...routeMetrics.entries()]
    .sort((left, right) => right[1].requests - left[1].requests)
    .slice(0, 50)
    .map(([route, metric]) => ({
      route,
      requests: metric.requests,
      errors: metric.errors,
      avgDurationMs: metric.requests ? Math.round(metric.totalDurationMs / metric.requests) : 0
    }));

  return {
    uptimeSeconds: Math.round(process.uptime()),
    startedAt: startedAt.toISOString(),
    memory: {
      rss: memory.rss,
      heapUsed: memory.heapUsed,
      heapTotal: memory.heapTotal
    },
    cpu: {
      loadAverage: os.loadavg(),
      systemMilliseconds: Math.round(cpu.system / 1_000),
      userMilliseconds: Math.round(cpu.user / 1_000)
    },
    routes
  };
}

function pruneRouteMetrics() {
  const retained = [...routeMetrics.entries()]
    .sort((left, right) => right[1].requests - left[1].requests)
    .slice(0, MAX_ROUTE_METRICS);

  routeMetrics.clear();

  for (const [route, metric] of retained) {
    routeMetrics.set(route, metric);
  }
}

function normalizePath(path: string) {
  return path
    .replace(/\?.*$/, "")
    .replace(/\/\d{5,32}(?=\/|$)/g, "/:id")
    .replace(/\/[0-9a-f]{8}-[0-9a-f-]{27,36}(?=\/|$)/gi, "/:uuid");
}
