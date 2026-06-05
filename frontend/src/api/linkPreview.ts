import type { LinkPreviewData } from '../types';
import { apiRequest } from './httpClient';

export const linkPreviewApi = {
  async get(url: string): Promise<LinkPreviewData> {
    return apiRequest<LinkPreviewData>(`/link-preview?url=${encodeURIComponent(url)}`);
  },
};
