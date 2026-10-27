// SPDX-License-Identifier: AGPL-3.0-only

export interface PaginationParams {
  page?: number;
  pageSize?: number;
}

export interface PaginatedResultDTO<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
