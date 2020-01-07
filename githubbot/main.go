package main

import (
	"bytes"
	"database/sql"
	"flag"
	"fmt"
	"os"
	"os/exec"

	_ "github.com/go-sql-driver/mysql"
	"github.com/keybase/go-keybase-chat-bot/kbchat"
	"github.com/keybase/go-keybase-chat-bot/kbchat/types/chat1"
	"github.com/keybase/managed-bots/base"
	"github.com/keybase/managed-bots/githubbot/githubbot"
	"golang.org/x/sync/errgroup"
)

type Options struct {
	KeybaseLocation string
	Home            string
	Announcement    string
	HTTPPrefix      string
	DSN             string
	Secret          string
}

func newOptions() Options {
	return Options{}
}

type BotServer struct {
	*base.Server

	opts Options
	kbc  *kbchat.API
}

func NewBotServer(opts Options) *BotServer {
	return &BotServer{
		Server: base.NewServer(opts.Announcement),
		opts:   opts,
	}
}

const backs = "```"

func (s *BotServer) makeAdvertisement() kbchat.Advertisement {
	subExtended := fmt.Sprintf(`Enables posting updates from the provided GitHub repository to this conversation.

Example:%s
!github subscribe keybase/client%s`,
		backs, backs)

	unsubExtended := fmt.Sprintf(`Disables updates from the provided GitHub repository to this conversation.

Example:%s
!github unsubscribe keybase/client%s`,
		backs, backs)

	watchExtended := fmt.Sprintf(`Subscribes to updates from a non-default branch on the provided repo.
	
Example:%s
!github watch facebook/react gh-pages%s`,
		backs, backs)

	unwatchExtended := fmt.Sprintf(`Disables updates from a non-default branch on the provided repo.

Example:%s
!github unwatch facebook/react gh-pages%s
	`, backs, backs)

	cmds := []chat1.UserBotCommandInput{
		{
			Name:        "github subscribe",
			Description: "Enable updates from GitHub repos",
			ExtendedDescription: &chat1.UserBotExtendedDescription{
				Title:       `*!github subscribe* <username/repo>`,
				DesktopBody: subExtended,
				MobileBody:  subExtended,
			},
		},
		{
			Name:        "github watch",
			Description: "Watch pushes from branch",
			ExtendedDescription: &chat1.UserBotExtendedDescription{
				Title:       `*!github watch* <username/repo> <branch>`,
				DesktopBody: watchExtended,
				MobileBody:  watchExtended,
			},
		},
		{
			Name:        "github unsubscribe",
			Description: "Disable updates from GitHub repos",
			ExtendedDescription: &chat1.UserBotExtendedDescription{
				Title:       `*!github unsubscribe* <username/repo>`,
				DesktopBody: unsubExtended,
				MobileBody:  unsubExtended,
			},
		},
		{
			Name:        "github unwatch",
			Description: "Disable updates from branch",
			ExtendedDescription: &chat1.UserBotExtendedDescription{
				Title:       `*!github unwatch* <username/repo> <branch>`,
				DesktopBody: unwatchExtended,
				MobileBody:  unwatchExtended,
			},
		},
	}
	return kbchat.Advertisement{
		Alias: "GitHub",
		Advertisements: []chat1.AdvertiseCommandAPIParam{
			{
				Typ:      "public",
				Commands: cmds,
			},
		},
	}
}

func (s *BotServer) getSecret() (string, error) {
	if s.opts.Secret != "" {
		return s.opts.Secret, nil
	}
	path := fmt.Sprintf("/keybase/private/%s/bot.secret", s.kbc.GetUsername())
	cmd := exec.Command("keybase", "fs", "read", path)
	var out bytes.Buffer
	cmd.Stdout = &out
	s.Debug("Running `keybase fs read` on %q and waiting for it to finish...\n", path)
	if err := cmd.Run(); err != nil {
		return "", err
	}
	return out.String(), nil
}

func (s *BotServer) Go() (err error) {
	if s.kbc, err = s.Start(s.opts.KeybaseLocation, s.opts.Home); err != nil {
		return err
	}

	secret, err := s.getSecret()
	if err != nil {
		s.Debug("failed to get secret: %s", err)
		return
	}
	sdb, err := sql.Open("mysql", s.opts.DSN)
	if err != nil {
		s.Debug("failed to connect to MySQL: %s", err)
		return err
	}
	db := githubbot.NewDB(sdb)
	if _, err := s.kbc.AdvertiseCommands(s.makeAdvertisement()); err != nil {
		s.Debug("advertise error: %s", err)
		return err
	}
	if err := s.SendAnnouncement(s.opts.Announcement, "I live."); err != nil {
		s.Debug("failed to announce self: %s", err)
		return err
	}

	httpSrv := githubbot.NewHTTPSrv(s.kbc, db, secret)
	handler := githubbot.NewHandler(s.kbc, db, httpSrv, s.opts.HTTPPrefix, secret)
	var eg errgroup.Group
	eg.Go(func() error { return s.Listen(handler) })
	eg.Go(httpSrv.Listen)
	eg.Go(func() error { return s.HandleSignals(httpSrv) })
	if err := eg.Wait(); err != nil {
		s.Debug("wait error: %s", err)
		return err
	}
	return nil
}

func main() {
	rc := mainInner()
	os.Exit(rc)
}

func mainInner() int {
	opts := newOptions()

	flag.StringVar(&opts.KeybaseLocation, "keybase", "keybase", "keybase command")
	flag.StringVar(&opts.Home, "home", "", "Home directory")
	flag.StringVar(&opts.Announcement, "announcement", os.Getenv("BOT_ANNOUNCEMENT"),
		"Where to announce we are running")
	flag.StringVar(&opts.DSN, "dsn", os.Getenv("BOT_DSN"), "Bot database DSN")
	flag.StringVar(&opts.HTTPPrefix, "http-prefix", os.Getenv("BOT_HTTP_PREFIX"), "address of bots HTTP server for webhooks")
	flag.StringVar(&opts.Secret, "secret", os.Getenv("BOT_WEBHOOK_SECRET"), "Webhook secret")
	flag.Parse()
	if len(opts.DSN) == 0 {
		fmt.Printf("must specify a poll database DSN\n")
		return 3
	}
	bs := NewBotServer(opts)
	if err := bs.Go(); err != nil {
		fmt.Printf("error running chat loop: %v\n", err)
	}
	return 0
}