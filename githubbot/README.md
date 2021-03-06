# GitHub Bot

A Keybase chat bot that notifies a channel when an event happens on a GitHub repository (issues, pull requests, commits, etc.).

## Prerequisites

In order to run the GitHub bot, you will need

- a running MySQL database in order to store GitHub OAuth tokens, user preferences, and channel subscriptions
- a [secret string](https://developer.github.com/webhooks/securing), used to authenticate webhooks from GitHub.
- the app ID, app name, client ID, and client secret from a [GitHub app](https://developer.github.com/apps/building-github-apps/creating-a-github-app/)
- the private key `.pem` file from your GitHub app

### Configuring your GitHub app

The GitHub bot sets itself up to serve HTTP requests on `/githubbot` plus a prefix indicating what the URLs will look like. The HTTP server runs on port 8080. You can configure nginx or any other reverse proxy software to route to this port and path.

When creating the [GitHub app](https://developer.github.com/apps/building-github-apps/creating-a-github-app/) for your bot, set the user authorization callback URL to `http://<your web server>/githubbot/oauth`, and set the webhook URL to `http://<your web server>/githubbot/webhook`. You should also include your webhook [secret string](https://developer.github.com/webhooks/securing).

The bot expects _read-only_ access to the Repository Permissions:

```
    - checks
    - contents
    - issues
    - pull requests
    - commit statuses
```

As well as the webhook events for:

```
    - check runs
    - pushes
    - statuses
    - issues
    - pull requests
```

## Running

1. On your SQL instance, create a database for the bot, and run `db.sql` to set up the tables.
2. Build the bot using Go 1.13+, like such (in this directory):

   ```
   go install .
   ```

3. To start the GitHub bot, run a command like this:
   ```
   $GOPATH/bin/githubbot --http-prefix 'http://<your web server>:8080' --dsn 'root@/githubbot' --app-name 'my-bot' --app-id 12345 --client-id '<OAuth client ID>' --client-secret '<OAuth client secret>' --secret '<your secret string>' --private-key-path '/path/to/bot.private-key.pem'
   ```
4. Run `githubbot --help` for more options.

### Helpful Tips

- If you accidentally run the bot under your own username and wish to clear the `!` commands, run the following:
  ```
  keybase chat clear-commands
  ```
- Restricted bots are restricted from knowing channel names. If you would like
  a bot to announce or report errors to a specific channel you can use a
  `ConversationID` which can be found by running:
  ```
  keybase chat conv-info teamname --channel channel
  ```
- By default, bots are unable to read their own messages. For development, it may be useful to disable this safeguard.
  You can do this using `--read-self` flag when running the bot.
- You can optionally save your GitHub app details inside your bot account's private KBFS folder. To do this, create a `credentials.json` file in `/keybase/private/<YourGitHubBot>` (or the equivalent KBFS path on your system) that matches the following format:
  ```js
  {
    "app_name": "your URL-safe GitHub app name",
    "app_id": 12345, // your GitHub app ID
    "client_id": "your GitHub OAuth client ID here",
    "client_secret": "your GitHub OAuth client secret here",
    "webhook_secret": "your secret here"
  }
  ```
  If you have KBFS running, you can now run the bot without providing the `--client-id`, `--client-secret`, `--app-id`, `--app-name`, and `--secret` command line options.
- You can store your private key file in KBFS by saving it in a file named `bot.private-key.pem` and omitting the `--private-key-path` argument.

### Docker

There are a few complications running a Keybase chat bot, and it is likely easiest to deploy using Docker. See https://hub.docker.com/r/keybaseio/client for our preferred client image to get started.
