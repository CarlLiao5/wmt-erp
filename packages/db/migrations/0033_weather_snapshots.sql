CREATE TABLE `weather_snapshots` (
  `id` varchar(36) NOT NULL, `state_code` varchar(2) NOT NULL, `source` varchar(32) NOT NULL, `observed_at` datetime(3), `metric` varchar(64) NOT NULL, `value` decimal(12,4), `unit` varchar(16), `source_updated_at` datetime(3), `cache_expires_at` datetime(3), `raw_payload` json, `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`), KEY `weather_snapshots_state_time_idx` (`state_code`,`observed_at`), KEY `weather_snapshots_source_idx` (`source`,`source_updated_at`)
);
CREATE TABLE `weather_forecasts` (
  `id` varchar(36) NOT NULL, `state_code` varchar(2) NOT NULL, `source` varchar(32) NOT NULL DEFAULT 'nws', `forecast_at` datetime(3) NOT NULL, `valid_from` datetime(3) NOT NULL, `valid_to` datetime(3), `temperature` decimal(8,2), `precipitation_probability` decimal(5,2), `unit` varchar(8), `condition` varchar(128), `raw_payload` json, `cache_expires_at` datetime(3), `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE KEY `weather_forecasts_state_valid_unique` (`state_code`,`valid_from`,`source`), KEY `weather_forecasts_state_time_idx` (`state_code`,`valid_from`)
);
CREATE TABLE `climate_outlooks` (
  `id` varchar(36) NOT NULL, `state_code` varchar(2) NOT NULL, `source` varchar(32) NOT NULL DEFAULT 'noaa-cpc', `period` varchar(32) NOT NULL, `valid_from` datetime(3), `valid_to` datetime(3), `temperature_above_normal` decimal(5,2), `temperature_near_normal` decimal(5,2), `temperature_below_normal` decimal(5,2), `precipitation_above_normal` decimal(5,2), `precipitation_near_normal` decimal(5,2), `precipitation_below_normal` decimal(5,2), `raw_payload` json, `cache_expires_at` datetime(3), `created_at` datetime(3) NOT NULL,
  PRIMARY KEY (`id`), UNIQUE KEY `climate_outlooks_state_period_unique` (`state_code`,`source`,`period`,`valid_from`), KEY `climate_outlooks_state_period_idx` (`state_code`,`valid_from`)
);
CREATE TABLE `weather_request_status` (
  `id` varchar(36) NOT NULL, `state_code` varchar(2) NOT NULL, `source` varchar(32) NOT NULL, `request_type` varchar(32) NOT NULL, `status` varchar(24) NOT NULL, `http_status` int, `attempts` int NOT NULL DEFAULT 0, `requested_at` datetime(3) NOT NULL, `completed_at` datetime(3), `error_message` text,
  PRIMARY KEY (`id`), KEY `weather_request_status_state_time_idx` (`state_code`,`requested_at`), KEY `weather_request_status_source_idx` (`source`,`status`)
);
