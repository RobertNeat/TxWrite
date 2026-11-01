import { Injectable } from '@nestjs/common';

export interface HealthStatus {
  status: 'ok';
  uptimeSeconds: number;
}

@Injectable()
export class HealthService {
  getStatus(): HealthStatus {
    return {
      status: 'ok',
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }
}
