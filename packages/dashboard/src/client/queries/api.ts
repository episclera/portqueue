/**
 * Typed client for the dashboard JSON API. Reads the mount base path from the injected
 * global config, sends the same-origin CSRF marker on mutations, and returns typed DTOs.
 */
import type {
  ActionRequestDto,
  ActionResultDto,
  DashboardConfigDto,
  InstanceBreakdownDto,
  JobDto,
  JobPageDto,
  QueueDto,
  ScheduleDto,
  StatsDto,
  WorkflowDto,
} from '../../shared/dto.js';

declare global {
  interface Window {
    __PORTQUEUE_DASHBOARD__?: DashboardConfigDto;
  }
}

export const config: DashboardConfigDto = (typeof window !== 'undefined' &&
  window.__PORTQUEUE_DASHBOARD__) || {
  basePath: '/portqueue',
  title: 'PortQueue Dashboard',
  theme: 'system',
  readOnly: false,
};

const API = `${config.basePath}/api`;

async function get<T>(path: string, params?: Record<string, string | undefined>): Promise<T> {
  const qs = params
    ? '?' +
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v as string)}`)
        .join('&')
    : '';
  const res = await fetch(`${API}${path}${qs}`, {
    headers: { 'x-requested-with': 'portqueue-dashboard' },
    credentials: 'same-origin',
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

export const api = {
  getQueues: () => get<QueueDto[]>('/queues'),
  getStats: (queue?: string) => get<StatsDto>('/stats', { queue }),
  getJobs: (params: {
    queue?: string;
    statuses?: string;
    scheduleId?: string;
    workflowId?: string;
    cursor?: string;
    limit?: string;
    order?: string;
  }) => get<JobPageDto>('/jobs', params),
  getJob: (jobId: string) => get<JobDto>(`/jobs/${encodeURIComponent(jobId)}`),
  getWorkflow: (workflowId: string) =>
    get<WorkflowDto>(`/workflows/${encodeURIComponent(workflowId)}`),
  getSchedules: (queue?: string) => get<ScheduleDto[]>('/schedules', { queue }),
  getInstances: (queue?: string) => get<InstanceBreakdownDto[]>('/instances', { queue }),

  action: async (body: ActionRequestDto): Promise<ActionResultDto> => {
    const res = await fetch(`${API}/actions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-requested-with': 'portqueue-dashboard',
      },
      credentials: 'same-origin',
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `${res.status} ${res.statusText}`);
    }
    return (await res.json()) as ActionResultDto;
  },
};

/** The SSE endpoint URL. */
export const eventsUrl = `${API}/events`;
