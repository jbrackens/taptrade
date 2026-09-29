import { useRouter } from "next/router";
import { FC } from "react";
import defaultMenuStructure from "../../../providers/menu/structure";
import PageHeader from "../../layout/page-header";
import { EditOutlined } from "@ant-design/icons";
import { Avatar, Popover, Tag } from "antd";
import { resolveStatus } from "../utils/resolvers";
import Spinner from "../../../components/layout/spinner";
import { first } from "lodash";
import { useTranslation } from "i18n";
import {
  Id,
  PunterCoolOff,
  PunterCoolOffReasonEnum,
  PunterName,
  PunterRichStatus,
  PunterStatus,
  PunterStatusEnum,
} from "@taptrade-ui/utils";
import UserAddNote from "../notes/add";
import UserLifecycleSuspend from "../lifecycle/suspend";

const { SHOW_FOR_SUBMISSION } =
  require("next/config").default().publicRuntimeConfig;

type Props = {
  editUserModalProps: (field?: string, currentValue?: {}) => void;
  name: PunterName;
  id: Id;
  richStatus?: PunterRichStatus;
  status: PunterStatus;
  coolOff: PunterCoolOff;
  isTestAccount: boolean;
  loading: boolean;
  onLifecycleChange: () => void;
};

export const UsersPageHeader: FC<Props> = ({
  name,
  editUserModalProps,
  richStatus,
  id,
  status,
  coolOff,
  isTestAccount,
  loading,
  onLifecycleChange,
}) => {
  const { t } = useTranslation("page-users-details");
  const { push } = useRouter();

  const { color, tKey } = resolveStatus(status);

  const changeNameClicked = () => {
    editUserModalProps("name", {
      Title: name?.title,
      Firstname: name?.firstName,
      Lastname: name?.lastName,
    });
  };

  const generateStatusPopover = () => {
    let statusTags = [
      <Tag role="userStatus" color={color}>
        {t(tKey).toUpperCase()}
      </Tag>,
    ];

    if (richStatus?.status === PunterStatusEnum.SUSPENDED) {
      statusTags = [
        <Popover
          placement="bottom"
          title={t("HEADER_CARD_DETAILS_SUSPENSION_REASON")}
          content={
            richStatus?.reason
              ? `${richStatus.reason.startTime} - ${richStatus.reason.endTime}`
              : null
          }
        >
          <Tag role="userStatus" color={color}>
            {t(tKey).toUpperCase()}
          </Tag>
        </Popover>,
      ];
    }

    if (coolOff?.cause === PunterCoolOffReasonEnum.SESSION_LIMIT_BREACH) {
      statusTags = [
        ...statusTags,
        <Tag role="userStatus" color="orange">
          {t("SESSION_LIMIT_REACHED")}
        </Tag>,
      ];
    }

    if (isTestAccount) {
      statusTags = [...statusTags, <Tag>{t("TEST_ACCOUNT")}</Tag>];
    }

    return statusTags;
  };

  const extraComponents = loading
    ? [<Spinner key="action-pull" inline label={t("SPINNER_DATA")} />]
    : [];

  const extraButtons = [
    <UserAddNote key="action-add-note" id={id} />,
    <UserLifecycleSuspend
      key="action-suspend"
      id={id}
      status={status}
      labels={{
        active: t("ACTION_UNLOCK"),
        inactive: t("ACTION_LOCK"),
      }}
      onComplete={onLifecycleChange}
    />,
  ];

  return (
    <PageHeader
      onBack={() => push(defaultMenuStructure.users.render())}
      title={
        <>
          <span role="punterName">
            {name?.firstName} {name?.lastName}{" "}
          </span>
          <a onClick={changeNameClicked}>
            <EditOutlined />
          </a>
        </>
      }
      tags={generateStatusPopover()}
      avatar={{
        src: (
          <Avatar>
            {first(name?.firstName)}
            {first(name?.lastName)}
          </Avatar>
        ),
      }}
      extra={
        Number(SHOW_FOR_SUBMISSION)
          ? [...extraComponents, ...extraButtons]
          : [...extraComponents, ...extraButtons]
      }
    />
  );
};
