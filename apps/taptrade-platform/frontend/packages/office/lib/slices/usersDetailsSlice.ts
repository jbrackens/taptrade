import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import {
  OfficePunter,
  OfficePunterSessionHistory,
  OfficePunterWallet,
  OfficePunterNotes,
} from "../../types/punters";
import { OfficeAuditLog, OfficeAuditLogs } from "../../types/logs";
import { parseTableMetaPagination } from "../utils/filters";
import { normalizeRecentActivities } from "../utils/recent-activities";
import { normalizeSupportNotesResponse } from "../utils/support-notes";
import {
  TablePagination,
  TableMeta,
  TablePaginationResponse,
} from "../../types/filters";

export type UsersDetailsSliceState = {
  basic: OfficePunter;
  recentActivities: any[];
  walletHistory: UsersDetailsWalletHistory;
  auditLogs: UsersDetailsAuditLogs;
  sessionHistory: UsersDetailsSessionHistory;
  notes: UsersDetailsNotes;
  updateNotes: boolean;
};

export type UsersDetailsWalletHistory = {
  data: OfficePunterWallet;
  paginationResponse: TablePagination | {};
} & TableMeta;

export type UsersDetailsWalletHistoryResponse = {
  data: OfficePunterWallet;
} & TablePaginationResponse;

export type UsersDetailsAuditLogs = {
  data: OfficeAuditLogs;
  paginationResponse: TablePagination | {};
} & TableMeta;

export type UsersDetailsAuditLogsResponse = {
  data: OfficeAuditLogs;
  items?: OfficeAuditLogs;
  pagination?: TablePaginationResponse;
} & TablePaginationResponse;

export type UsersDetailsSessionHistory = {
  data: OfficePunterSessionHistory;
  paginationResponse: TablePagination | {};
} & TableMeta;

export type UsersDetailsSessionHistoryResponse = {
  data: OfficePunterSessionHistory;
} & TablePaginationResponse;

export type UsersDetailsNotes = {
  data: OfficePunterNotes;
  paginationResponse: TablePagination | {};
} & TableMeta;

export type UsersDetailsNotesResponse = {
  data: OfficePunterNotes;
  pagination?: {
    page?: number;
    limit?: number;
    total?: number;
  };
} & TablePaginationResponse;

const normalizeGoAuditRow = (row: any): OfficeAuditLog => {
  if (!row || typeof row !== "object") {
    return row;
  }
  const normalized: OfficeAuditLog = { ...row };
  if (row.actor_id !== undefined && normalized.actorId === undefined) {
    normalized.actorId = row.actor_id;
  }
  if (row.entity_type !== undefined) {
    if (normalized.category === undefined) {
      normalized.category = row.entity_type;
    }
    if (normalized.type === undefined) {
      normalized.type = row.entity_type;
    }
  }
  if (row.entity_id !== undefined && normalized.targetId === undefined) {
    normalized.targetId = row.entity_id;
  }
  if (row.old_value !== undefined && normalized.dataBefore === undefined) {
    normalized.dataBefore =
      typeof row.old_value === "object" ? row.old_value : undefined;
  }
  if (row.new_value !== undefined && normalized.dataAfter === undefined) {
    normalized.dataAfter =
      typeof row.new_value === "object" ? row.new_value : undefined;
  }
  if (row.created_at !== undefined && normalized.createdAt === undefined) {
    normalized.createdAt = row.created_at;
  }
  if (row.ip_address !== undefined) {
    normalized.ipAddress = row.ip_address;
  }
  return normalized;
};

const normalizeGoAuditPagination = (
  pagination: any,
): { currentPage: number; itemsPerPage: number; totalCount: number } => {
  if (!pagination || typeof pagination !== "object") {
    return { currentPage: 1, itemsPerPage: 20, totalCount: 0 };
  }
  return {
    currentPage: pagination.currentPage || pagination.page || 1,
    itemsPerPage: pagination.itemsPerPage || pagination.limit || 20,
    totalCount: pagination.totalCount ?? pagination.total ?? 0,
  };
};

const initialState: UsersDetailsSliceState = {
  basic: {} as OfficePunter,
  recentActivities: [],
  walletHistory: {
    data: [],
    pagination: {},
    paginationResponse: {},
    filters: {},
    sorting: {},
  },
  auditLogs: {
    data: [],
    pagination: {},
    paginationResponse: {},
    filters: {},
    sorting: {},
  },
  sessionHistory: {
    data: [],
    pagination: {},
    paginationResponse: {},
    filters: {},
    sorting: {},
  },
  notes: {
    data: [],
    pagination: {},
    paginationResponse: {},
    filters: {},
    sorting: {},
  },
  updateNotes: false,
};

export type UsersDetailsSlice = {
  usersDetails: UsersDetailsSliceState;
};

const usersDetailsSlice = createSlice({
  name: "usersDetails",
  initialState,
  reducers: {
    getUserDetails: () => {},

    getUserDetailsSucceeded: (
      state: UsersDetailsSliceState,
      action: PayloadAction<OfficePunter>,
    ) => {
      if (action?.payload) {
        state.basic = { ...action.payload };
      }
    },

    getUserRecentActivities: () => {},

    getUserRecentActivitiesSucceeded: (
      state: UsersDetailsSliceState,
      action: PayloadAction<any>,
    ) => {
      if (action?.payload) {
        state.recentActivities = normalizeRecentActivities(action.payload);
      }
    },

    getUserWallet: () => {},

    getUserWalletSucceeded: (
      state: UsersDetailsSliceState,
      action: PayloadAction<UsersDetailsWalletHistoryResponse>,
    ) => {
      if (action?.payload) {
        const { data, ...rest } = action.payload;
        state.walletHistory.data = [...data];
        state.walletHistory.paginationResponse = parseTableMetaPagination(rest);
      }
    },

    getUserAuditLogs: () => {},

    getUserAuditLogsSucceeded: (
      state: UsersDetailsSliceState,
      action: PayloadAction<UsersDetailsAuditLogsResponse>,
    ) => {
      if (action?.payload) {
        const payload = action.payload as UsersDetailsAuditLogsResponse;
        const rawData =
          Array.isArray(payload.data) && payload.data.length > 0
            ? payload.data
            : Array.isArray(payload.items)
              ? payload.items
              : [];
        const data = rawData.map(normalizeGoAuditRow);
        const pagination = payload.pagination
          ? normalizeGoAuditPagination(payload.pagination)
          : {
              currentPage: payload.currentPage || 1,
              itemsPerPage: payload.itemsPerPage || 10,
              totalCount: payload.totalCount || data.length,
            };
        state.auditLogs.data = [...data];
        state.auditLogs.paginationResponse =
          parseTableMetaPagination(pagination);
      }
    },

    getUserSessionHistory: () => {},

    getUserSessionHistorySucceeded: (
      state: UsersDetailsSliceState,
      action: PayloadAction<UsersDetailsSessionHistoryResponse>,
    ) => {
      if (action?.payload) {
        const { data, ...rest } = action.payload;
        state.sessionHistory.data = [...data];
        state.sessionHistory.paginationResponse =
          parseTableMetaPagination(rest);
      }
    },

    getUserNotes: () => {},

    setUserNotesUpdate: (
      state: UsersDetailsSliceState,
      action: PayloadAction<boolean>,
    ) => {
      state.updateNotes = action.payload;
    },

    getUserNotesSucceeded: (
      state: UsersDetailsSliceState,
      action: PayloadAction<UsersDetailsNotesResponse>,
    ) => {
      if (action?.payload) {
        const normalized = normalizeSupportNotesResponse(action.payload);
        state.notes.data = normalized.data;
        state.notes.paginationResponse = parseTableMetaPagination(
          normalized.pagination,
        );
      }
    },
  },
});

export const selectBasicData = (state: UsersDetailsSlice) =>
  state.usersDetails.basic;
export const selectRecentActivities = (state: UsersDetailsSlice) =>
  state.usersDetails.recentActivities;

export const selectWalletData = (state: UsersDetailsSlice) =>
  state.usersDetails.walletHistory.data;
export const selectWalletTableMeta = (state: UsersDetailsSlice) => {
  const { pagination, paginationResponse, filters, sorting } =
    state.usersDetails.walletHistory;
  return { pagination, paginationResponse, filters, sorting };
};

export const selectAuditLogsData = (state: UsersDetailsSlice) =>
  state.usersDetails.auditLogs.data;
export const selectAuditLogsTableMeta = (state: UsersDetailsSlice) => {
  const { pagination, paginationResponse, filters, sorting } =
    state.usersDetails.auditLogs;
  return { pagination, paginationResponse, filters, sorting };
};

export const selectSessionHistoryData = (state: UsersDetailsSlice) =>
  state.usersDetails.sessionHistory.data;
export const selectSessionHistoryTableMeta = (state: UsersDetailsSlice) => {
  const { pagination, paginationResponse, filters, sorting } =
    state.usersDetails.sessionHistory;
  return { pagination, paginationResponse, filters, sorting };
};

export const selectNotesData = (state: UsersDetailsSlice) =>
  state.usersDetails.notes.data;
export const selectUpdateNotes = (state: UsersDetailsSlice) =>
  state.usersDetails.updateNotes;
export const selectNotesTableMeta = (state: UsersDetailsSlice) => {
  const { pagination, paginationResponse, filters, sorting } =
    state.usersDetails.notes;
  return { pagination, paginationResponse, filters, sorting };
};

export const {
  getUserDetails,
  getUserDetailsSucceeded,
  getUserRecentActivities,
  getUserRecentActivitiesSucceeded,
  getUserWallet,
  getUserWalletSucceeded,
  getUserAuditLogs,
  getUserAuditLogsSucceeded,
  getUserSessionHistory,
  getUserSessionHistorySucceeded,
  getUserNotes,
  setUserNotesUpdate,
  getUserNotesSucceeded,
} = usersDetailsSlice.actions;

export default usersDetailsSlice.reducer;
