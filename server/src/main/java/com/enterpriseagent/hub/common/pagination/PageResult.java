package com.enterpriseagent.hub.common.pagination;

import java.util.List;

public record PageResult<T>(List<T> items, int page, int pageSize, long total, boolean hasNext) {
    private static final int MAX_PAGE_SIZE = 100;

    public static <T> PageResult<T> of(List<T> allItems, int page, int pageSize) {
        int safePage = Math.max(page, 1);
        int safePageSize = Math.min(Math.max(pageSize, 1), MAX_PAGE_SIZE);
        int from = Math.min((safePage - 1) * safePageSize, allItems.size());
        int to = Math.min(from + safePageSize, allItems.size());
        return new PageResult<>(allItems.subList(from, to), safePage, safePageSize, allItems.size(), to < allItems.size());
    }
}
