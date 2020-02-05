CREATE TABLE `subscriptions` (
  `conv_id` char(64) NOT NULL,
  `repo` varchar(128) NOT NULL,
  `branch` varchar(128) NOT NULL,
  `oauth_identifier` varchar(128) NOT NULL,
  UNIQUE KEY unique_subscription (`conv_id`, `repo`, `branch`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8;
