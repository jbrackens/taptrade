import { enumToObject } from "../../../lib/utils/enums";
import { buildTableFilterOptions } from "../../../lib/utils/filters";
import { PunterStatus, PunterStatusEnum } from "@taptrade-ui/utils";

export const resolveStatus = (status: PunterStatus) => {
  let color = "grey";
  let tKey = "CELL_STATUS_UNKNOWN";
  switch (status) {
    case PunterStatusEnum.ACTIVE:
      color = "green";
      tKey = "CELL_STATUS_ACTIVE";
      break;
    case PunterStatusEnum.COOLING_OFF:
      color = "orange";
      tKey = "CELL_STATUS_COOLING_OFF";
      break;
    case PunterStatusEnum.SUSPENDED:
      color = "red";
      tKey = "CELL_STATUS_SUSPENDED";
      break;
    case PunterStatusEnum.UNVERIFIED:
      color = "blue";
      tKey = "CELL_STATUS_UNVERIFIED";
      break;
  }
  return { color, tKey };
};

export const composeOptions = (t: any, prefix?: string) =>
  buildTableFilterOptions(enumToObject(PunterStatusEnum), t, prefix);
