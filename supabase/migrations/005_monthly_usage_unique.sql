create unique index if not exists monthly_usage_client_month_uidx
  on monthly_usage(client_id, month);
