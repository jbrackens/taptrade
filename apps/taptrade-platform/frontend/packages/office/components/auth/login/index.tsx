import React, { useEffect, useState } from "react";
import { Form, Input, Button, Row, Col, Alert, Layout } from "antd";
import { useTranslation } from "i18n";
import { LoginOutlined } from "@ant-design/icons";
import { useApi } from "../../../services/api/api-service";
import {
  useToken,
  Method,
  useSpy,
  SpyCallbackProps,
  appendSecondsToTimestamp,
  useFingerprint,
} from "@taptrade-ui/utils";
import { isEligibleToAccess, validateAndDecode } from "../../../utils/auth";
import { brand } from "../../../lib/brand";
import { LoginFormComponent, LoginForm, LoginWrapper } from "./index.styled";
import { useContext } from "react";
import { ThemeContext } from "../../app/theme-context";
import { Logo } from "../../layout/header/logo";
import { isEqual } from "lodash";
import Spinner from "../../layout/spinner";
import dayjs from "dayjs";
import { useRouter } from "next/router";
import { MfaModalComponent } from "../mfa-modal";

const { eligibleRoles } = require("next/config").default().publicRuntimeConfig;

const { Header } = Layout;

type FormValues = {
  password: string | undefined;
  username: string | undefined;
};

const LoginComponent: React.FC = () => {
  const { t } = useTranslation(["login"]);
  const { query, push } = useRouter();
  const { redirectTo } = query;
  const theme = useContext(ThemeContext);
  const [form, setFormValue] = useState<FormValues>({} as FormValues);
  const [formFinished, setFormFinished] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | undefined>();
  const [triggerApi, isLoading, response] = useApi("login", Method.POST);
  const [
    triggerLoginWithVerification,
    ,
    loginWithVerificationResponse,
    ,
    resetLoginWithVerificationState,
  ] = useApi("login-with-verification", Method.POST);
  const { saveToken, saveTokenExpDate } = useToken();
  const { spy } = useSpy();
  const { data, error } = response;

  const [formInstansce] = Form.useForm();

  const fingerprintData = useFingerprint();
  const deviceFingerprint = fingerprintData?.visitorId || undefined;

  const checkAndSetupTokens = ({ prevValues, values }: SpyCallbackProps) => {
    if (values && !isEqual(values, prevValues)) {
      const { token, refreshToken, expiresIn, refreshExpiresIn } = values;
      const now = dayjs().valueOf();
      const expiresInTimestamp = appendSecondsToTimestamp(expiresIn, now);
      const refreshExpiresInTimestamp = appendSecondsToTimestamp(
        refreshExpiresIn,
        now,
      );

      // DEV MODE: the Go gateway returns opaque tokens (atk_...) that can't be
      // decoded as JWTs. Accept any non-empty token in development.
      const isDev = process.env.NODE_ENV === "development";
      const isEligible = isDev
        ? !!token
        : isEligibleToAccess(validateAndDecode(token), eligibleRoles);

      if (token && refreshToken && isEligible) {
        saveToken(token, refreshToken);
        saveTokenExpDate(expiresInTimestamp, refreshExpiresInTimestamp);
        push((redirectTo as string) || "/users");
      } else {
        setErrorMessage(t("GLOBAL_ERROR_NOT_ELIGIBLE"));
      }
    }
  };

  const loginWithVerification = async (verificationCode: string) => {
    resetLoginWithVerificationState();
    if (verificationCode) {
      const { username, password } = form;
      triggerLoginWithVerification({
        password,
        username,
        verificationId: verificationId,
        verificationCode: verificationCode,
        deviceFingerprint: deviceFingerprint,
      });
      setFormFinished(false);
    }
  };

  const proceedSubmitRequest = async ({ values }: SpyCallbackProps) => {
    if (values) {
      setErrorMessage(undefined);
      const { username, password } = form;
      await triggerApi({
        password,
        username,
        deviceFingerprint: deviceFingerprint,
      });
      setFormFinished(false);
    }
  };

  const onFinish = (values: FormValues): void => {
    setFormValue(values);
    setFormFinished(true);
  };

  useEffect(() => {}, [formFinished]);

  const [verificationId, setVerificationId] = useState<string | null>(null);
  const [isMfaCodeModalVisible, setMfaCodeModalVisible] = useState(false);

  useEffect(() => {
    if (data?.type === "VERIFICATION_REQUESTED") {
      setVerificationId(data?.verificationId);
      setMfaCodeModalVisible(true);
    }
  }, [data]);

  spy(data?.token, checkAndSetupTokens);
  spy(loginWithVerificationResponse?.data?.token, checkAndSetupTokens);
  spy(formFinished, proceedSubmitRequest);

  return (
    <LoginWrapper>
      <LoginFormComponent>
        <Header>
          <Logo theme={theme?.logo} />
          {brand.name} Backoffice
        </Header>

        <LoginForm>
          {isLoading && (
            <Spinner
              data-testid="loading"
              overlay={true}
              label={t("SIGN_UP_LOADING")}
            />
          )}
          <Form
            layout={"vertical"}
            name="loginForm"
            onFinish={onFinish}
            form={formInstansce}
          >
            <Form.Item
              label={t("USERNAME")}
              name="username"
              rules={[
                {
                  required: true,
                  message: t("USERNAME_ERROR"),
                },
              ]}
            >
              <Input
                onBlur={(value) => {
                  formInstansce.setFieldsValue({
                    username: value.currentTarget.value.trim(),
                  });
                }}
              />
            </Form.Item>

            <Form.Item
              label={t("PASSWORD")}
              name="password"
              rules={[
                {
                  required: true,
                  message: t("PASSWORD_ERROR"),
                },
              ]}
            >
              <Input.Password />
            </Form.Item>

            {(error || errorMessage) && (
              <Row
                justify="center"
                align="middle"
                gutter={[32, 32]}
                role="error"
              >
                <Col span={24}>
                  <Alert
                    message={errorMessage || t("LOGIN_ERROR")}
                    type="error"
                    showIcon
                  />
                </Col>
              </Row>
            )}

            <Row justify="center" align="middle">
              <Button
                type="primary"
                htmlType="submit"
                shape="round"
                icon={<LoginOutlined />}
                size="large"
                block
              >
                {t("SIGN_IN")}
              </Button>
            </Row>
          </Form>
        </LoginForm>
      </LoginFormComponent>
      <MfaModalComponent
        showModal={isMfaCodeModalVisible}
        onRequestWithVerification={loginWithVerification}
        onCancelVerification={() => setMfaCodeModalVisible(false)}
        requestCode={false}
        verificationSuccess={!!loginWithVerificationResponse?.succeeded}
        requestErrors={
          loginWithVerificationResponse?.error?.payload?.errors || []
        }
      />
    </LoginWrapper>
  );
};

export { LoginComponent };
