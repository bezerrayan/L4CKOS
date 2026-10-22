import { describe, expect, it, vi } from "vitest";
import {
  ASAAS_WEBHOOK_RECOVERY_FLAG,
  PAYMENT_NOTIFICATION_RECOVERY_FLAG,
  prepareRecoveryWorkerStartup,
  resolveRecoveryWorkerStartup,
} from "./recoveryWorkerStartup";

function starters() {
  return {
    startPaymentNotifications: vi.fn(),
    startAsaasWebhookRecovery: vi.fn(),
  };
}

describe("financial recovery worker startup gates", () => {
  it("keeps both workers disabled by default in staging, including NODE_ENV=production", () => {
    expect(
      resolveRecoveryWorkerStartup({
        APP_ENV: "staging",
        NODE_ENV: "production",
      })
    ).toEqual({
      paymentNotifications: false,
      asaasWebhookRecovery: false,
    });
  });

  it("keeps both workers disabled when staging flags are explicitly false", () => {
    expect(
      resolveRecoveryWorkerStartup({
        APP_ENV: "staging",
        [PAYMENT_NOTIFICATION_RECOVERY_FLAG]: "false",
        [ASAAS_WEBHOOK_RECOVERY_FLAG]: "false",
      })
    ).toEqual({ paymentNotifications: false, asaasWebhookRecovery: false });
  });

  it("fails closed for an invalid flag before any worker starter can run", () => {
    const run = starters();
    expect(() =>
      prepareRecoveryWorkerStartup(
        {
          APP_ENV: "staging",
          [PAYMENT_NOTIFICATION_RECOVERY_FLAG]: "yes",
        },
        run
      )
    ).toThrow(
      `INVALID_RECOVERY_WORKER_FLAG:${PAYMENT_NOTIFICATION_RECOVERY_FLAG}`
    );

    expect(run.startPaymentNotifications).not.toHaveBeenCalled();
    expect(run.startAsaasWebhookRecovery).not.toHaveBeenCalled();
  });

  it("starts only the worker whose staging flag is explicitly true", () => {
    const run = starters();
    const startup = prepareRecoveryWorkerStartup(
      {
        APP_ENV: "staging",
        [PAYMENT_NOTIFICATION_RECOVERY_FLAG]: "true",
        [ASAAS_WEBHOOK_RECOVERY_FLAG]: "false",
      },
      run
    );

    startup.start();

    expect(run.startPaymentNotifications).toHaveBeenCalledOnce();
    expect(run.startAsaasWebhookRecovery).not.toHaveBeenCalled();
  });

  it("does not invoke either starter, timer, tick, claim, provider, or email path when staging gates are closed", () => {
    const sideEffects = {
      createTimer: vi.fn(),
      runInitialTick: vi.fn(),
      claimNotification: vi.fn(),
      recoverWebhook: vi.fn(),
      queryProvider: vi.fn(),
      sendEmail: vi.fn(),
    };
    const run = {
      startPaymentNotifications: vi.fn(() => {
        sideEffects.createTimer();
        sideEffects.runInitialTick();
        sideEffects.claimNotification();
        sideEffects.sendEmail();
      }),
      startAsaasWebhookRecovery: vi.fn(() => {
        sideEffects.createTimer();
        sideEffects.runInitialTick();
        sideEffects.recoverWebhook();
        sideEffects.queryProvider();
      }),
    };

    const startup = prepareRecoveryWorkerStartup({ APP_ENV: "staging" }, run);
    startup.start();

    expect(run.startPaymentNotifications).not.toHaveBeenCalled();
    expect(run.startAsaasWebhookRecovery).not.toHaveBeenCalled();
    for (const effect of Object.values(sideEffects))
      expect(effect).not.toHaveBeenCalled();
  });

  it("preserves the previous non-staging default and supports independently enabling the webhook worker", () => {
    expect(
      resolveRecoveryWorkerStartup({
        APP_ENV: "production",
        NODE_ENV: "production",
      })
    ).toEqual({
      paymentNotifications: true,
      asaasWebhookRecovery: true,
    });

    const run = starters();
    const staging = prepareRecoveryWorkerStartup(
      {
        APP_ENV: "staging",
        [ASAAS_WEBHOOK_RECOVERY_FLAG]: "true",
      },
      run
    );
    staging.start();
    expect(run.startAsaasWebhookRecovery).toHaveBeenCalledOnce();
    expect(run.startPaymentNotifications).not.toHaveBeenCalled();
  });
});
