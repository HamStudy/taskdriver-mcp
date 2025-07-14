import { performance } from 'perf_hooks';

/**
 * Metrics Collection System for TaskDriver
 * Collects and aggregates metrics for monitoring and observability
 */

export interface MetricValue {
  timestamp: number;
  value: number;
  labels?: Record<string, string>;
}

export interface CounterMetric {
  name: string;
  help: string;
  values: Map<string, number>;
}

export interface GaugeMetric {
  name: string;
  help: string;
  values: Map<string, number>;
}

export interface HistogramMetric {
  name: string;
  help: string;
  buckets: number[];
  counts: Map<string, number[]>;
  sums: Map<string, number>;
  totalCounts: Map<string, number>;
}

export interface TimerResult {
  duration: number;
  stop: () => number;
}

class MetricsCollector {
  private counters = new Map<string, CounterMetric>();
  private gauges = new Map<string, GaugeMetric>();
  private histograms = new Map<string, HistogramMetric>();
  private startTime = Date.now();

  /**
   * Create or get a counter metric
   */
  counter(name: string, help: string = ''): CounterMetric {
    if (!this.counters.has(name)) {
      this.counters.set(name, {
        name,
        help,
        values: new Map()
      });
    }
    return this.counters.get(name)!;
  }

  /**
   * Create or get a gauge metric
   */
  gauge(name: string, help: string = ''): GaugeMetric {
    if (!this.gauges.has(name)) {
      this.gauges.set(name, {
        name,
        help,
        values: new Map()
      });
    }
    return this.gauges.get(name)!;
  }

  /**
   * Create or get a histogram metric
   */
  histogram(
    name: string, 
    help: string = '', 
    buckets: number[] = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
  ): HistogramMetric {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, {
        name,
        help,
        buckets,
        counts: new Map(),
        sums: new Map(),
        totalCounts: new Map()
      });
    }
    return this.histograms.get(name)!;
  }

  /**
   * Increment a counter
   */
  incrementCounter(name: string, labels?: Record<string, string>, value: number = 1): void {
    const counter = this.counter(name);
    const labelKey = this.getLabelKey(labels);
    const currentValue = counter.values.get(labelKey) || 0;
    counter.values.set(labelKey, currentValue + value);
  }

  /**
   * Set a gauge value
   */
  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const gauge = this.gauge(name);
    const labelKey = this.getLabelKey(labels);
    gauge.values.set(labelKey, value);
  }

  /**
   * Increment a gauge value
   */
  incrementGauge(name: string, value: number = 1, labels?: Record<string, string>): void {
    const gauge = this.gauge(name);
    const labelKey = this.getLabelKey(labels);
    const currentValue = gauge.values.get(labelKey) || 0;
    gauge.values.set(labelKey, currentValue + value);
  }

  /**
   * Decrement a gauge value
   */
  decrementGauge(name: string, value: number = 1, labels?: Record<string, string>): void {
    this.incrementGauge(name, -value, labels);
  }

  /**
   * Observe a value in a histogram
   */
  observeHistogram(name: string, value: number, labels?: Record<string, string>): void {
    const histogram = this.histogram(name);
    const labelKey = this.getLabelKey(labels);

    // Initialize arrays if they don't exist
    if (!histogram.counts.has(labelKey)) {
      histogram.counts.set(labelKey, new Array(histogram.buckets.length + 1).fill(0));
      histogram.sums.set(labelKey, 0);
      histogram.totalCounts.set(labelKey, 0);
    }

    // Update counts
    const counts = histogram.counts.get(labelKey);
    if (!counts || !histogram.buckets) {
      return;
    }
    
    for (let i = 0; i < histogram.buckets.length; i++) {
      const bucket = histogram.buckets[i];
      if (bucket !== undefined && value <= bucket) {
        const currentCount = counts[i];
        if (currentCount !== undefined) {
          counts[i] = currentCount + 1;
        }
      }
    }
    const lastIndex = counts.length - 1;
    const lastCount = counts[lastIndex];
    if (lastCount !== undefined) {
      counts[lastIndex] = lastCount + 1; // +Inf bucket
    }

    // Update sum and total count
    const currentSum = histogram.sums.get(labelKey) || 0;
    const currentCount = histogram.totalCounts.get(labelKey) || 0;
    histogram.sums.set(labelKey, currentSum + value);
    histogram.totalCounts.set(labelKey, currentCount + 1);
  }

  /**
   * Start a timer and return a function to stop it
   */
  startTimer(name: string, labels?: Record<string, string>): TimerResult {
    const startTime = performance.now();
    
    const stop = (): number => {
      const duration = (performance.now() - startTime) / 1000; // Convert to seconds
      this.observeHistogram(name, duration, labels);
      return duration;
    };

    return {
      duration: 0,
      stop
    };
  }

  /**
   * Time an async function
   */
  async timeAsync<T>(
    name: string,
    fn: () => Promise<T>,
    labels?: Record<string, string>
  ): Promise<T> {
    const timer = this.startTimer(name, labels);
    try {
      const result = await fn();
      timer.stop();
      return result;
    } catch (error) {
      timer.stop();
      throw error;
    }
  }

  /**
   * Time a sync function
   */
  timeSync<T>(
    name: string,
    fn: () => T,
    labels?: Record<string, string>
  ): T {
    const timer = this.startTimer(name, labels);
    try {
      const result = fn();
      timer.stop();
      return result;
    } catch (error) {
      timer.stop();
      throw error;
    }
  }

  /**
   * Get all metrics in Prometheus format
   */
  getPrometheusMetrics(): string {
    let output = '';

    // Counters
    for (const counter of this.counters.values()) {
      if (counter.help) {
        output += `# HELP ${counter.name} ${counter.help}\n`;
      }
      output += `# TYPE ${counter.name} counter\n`;
      
      for (const [labelKey, value] of counter.values) {
        const labels = labelKey ? `{${labelKey}}` : '';
        output += `${counter.name}${labels} ${value}\n`;
      }
    }

    // Gauges
    for (const gauge of this.gauges.values()) {
      if (gauge.help) {
        output += `# HELP ${gauge.name} ${gauge.help}\n`;
      }
      output += `# TYPE ${gauge.name} gauge\n`;
      
      for (const [labelKey, value] of gauge.values) {
        const labels = labelKey ? `{${labelKey}}` : '';
        output += `${gauge.name}${labels} ${value}\n`;
      }
    }

    // Histograms
    for (const histogram of this.histograms.values()) {
      if (histogram.help) {
        output += `# HELP ${histogram.name} ${histogram.help}\n`;
      }
      output += `# TYPE ${histogram.name} histogram\n`;
      
      for (const [labelKey, counts] of histogram.counts) {
        const baseLabels = labelKey ? labelKey + ',' : '';
        
        // Bucket counts
        for (let i = 0; i < histogram.buckets.length; i++) {
          const bucketLabels = `{${baseLabels}le="${histogram.buckets[i]}"}`;
          output += `${histogram.name}_bucket${bucketLabels} ${counts[i]}\n`;
        }
        
        // +Inf bucket
        const infLabels = `{${baseLabels}le="+Inf"}`;
        output += `${histogram.name}_bucket${infLabels} ${counts[counts.length - 1]}\n`;
        
        // Sum and count
        const labels = labelKey ? `{${labelKey}}` : '';
        output += `${histogram.name}_sum${labels} ${histogram.sums.get(labelKey)}\n`;
        output += `${histogram.name}_count${labels} ${histogram.totalCounts.get(labelKey)}\n`;
      }
    }

    return output;
  }

  /**
   * Get all metrics as JSON
   */
  getJsonMetrics(): any {
    return {
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      counters: Object.fromEntries(
        Array.from(this.counters.entries()).map(([name, metric]) => [
          name,
          {
            help: metric.help,
            values: Object.fromEntries(metric.values)
          }
        ])
      ),
      gauges: Object.fromEntries(
        Array.from(this.gauges.entries()).map(([name, metric]) => [
          name,
          {
            help: metric.help,
            values: Object.fromEntries(metric.values)
          }
        ])
      ),
      histograms: Object.fromEntries(
        Array.from(this.histograms.entries()).map(([name, metric]) => [
          name,
          {
            help: metric.help,
            buckets: metric.buckets,
            values: Object.fromEntries(
              Array.from(metric.counts.entries()).map(([labelKey, counts]) => [
                labelKey,
                {
                  counts,
                  sum: metric.sums.get(labelKey),
                  count: metric.totalCounts.get(labelKey)
                }
              ])
            )
          }
        ])
      )
    };
  }

  /**
   * Reset all metrics
   */
  reset(): void {
    this.counters.clear();
    this.gauges.clear();
    this.histograms.clear();
    this.startTime = Date.now();
  }

  /**
   * Get basic system metrics
   */
  getSystemMetrics(): any {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    return {
      memory: {
        rss: memUsage.rss,
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        arrayBuffers: memUsage.arrayBuffers
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      uptime: process.uptime(),
      pid: process.pid,
      version: process.version,
      platform: process.platform,
      arch: process.arch
    };
  }

  private getLabelKey(labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return '';
    }
    
    return Object.entries(labels)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}="${value}"`)
      .join(',');
  }
}

// Default metrics instance
export const metrics = new MetricsCollector();

// Export MetricsCollector class for custom instances
export { MetricsCollector };

/**
 * Common TaskDriver metrics
 */
export const TaskDriverMetrics = {
  // HTTP metrics
  httpRequestsTotal: metrics.counter('taskdriver_http_requests_total', 'Total HTTP requests'),
  httpRequestDuration: metrics.histogram('taskdriver_http_request_duration_seconds', 'HTTP request duration'),
  httpRequestsInFlight: metrics.gauge('taskdriver_http_requests_in_flight', 'HTTP requests currently being processed'),

  // Session metrics
  sessionsActive: metrics.gauge('taskdriver_sessions_active', 'Number of active sessions'),
  sessionsCreated: metrics.counter('taskdriver_sessions_created_total', 'Total sessions created'),
  sessionDuration: metrics.histogram('taskdriver_session_duration_seconds', 'Session duration'),

  // Storage metrics
  storageOperations: metrics.counter('taskdriver_storage_operations_total', 'Total storage operations'),
  storageOperationDuration: metrics.histogram('taskdriver_storage_operation_duration_seconds', 'Storage operation duration'),
  storageErrors: metrics.counter('taskdriver_storage_errors_total', 'Total storage errors'),

  // Task metrics
  tasksTotal: metrics.gauge('taskdriver_tasks_total', 'Total number of tasks'),
  tasksQueued: metrics.gauge('taskdriver_tasks_queued', 'Number of queued tasks'),
  tasksRunning: metrics.gauge('taskdriver_tasks_running', 'Number of running tasks'),
  tasksCompleted: metrics.counter('taskdriver_tasks_completed_total', 'Total completed tasks'),
  tasksFailed: metrics.counter('taskdriver_tasks_failed_total', 'Total failed tasks'),
  taskDuration: metrics.histogram('taskdriver_task_duration_seconds', 'Task execution duration'),

  // Agent metrics
  agentsConnected: metrics.gauge('taskdriver_agents_connected', 'Number of connected agents'),
  agentOperations: metrics.counter('taskdriver_agent_operations_total', 'Total agent operations'),

  // Project metrics
  projectsActive: metrics.gauge('taskdriver_projects_active', 'Number of active projects'),

  // Lease metrics
  leasesActive: metrics.gauge('taskdriver_leases_active', 'Number of active leases'),
  leasesExpired: metrics.counter('taskdriver_leases_expired_total', 'Total expired leases'),

  // MCP metrics
  mcpConnections: metrics.gauge('taskdriver_mcp_connections', 'Number of MCP connections'),
  mcpRequestsTotal: metrics.counter('taskdriver_mcp_requests_total', 'Total MCP requests'),
  mcpRequestDuration: metrics.histogram('taskdriver_mcp_request_duration_seconds', 'MCP request duration')
};