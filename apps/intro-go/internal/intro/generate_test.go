package intro

import (
	"database/sql"
	"strings"
	"testing"

	"intro-go/internal/db"
)

func TestGenerate(t *testing.T) {
	t.Parallel()

	ada := &db.User{ID: "u1", Name: "Ada", Email: "ada@example.com"}
	adaGitHub := &db.GithubProfile{
		UserID:      "u1",
		Username:    "ada",
		Bio:         sql.NullString{String: "math pioneer", Valid: true},
		PublicRepos: 12,
		AvatarURL:   "https://avatars.example.com/ada.png",
	}
	adaGitHubNoBio := &db.GithubProfile{
		UserID:    "u1",
		Username:  "ada",
		AvatarURL: "https://avatars.example.com/ada.png",
	}
	userNoEmail := &db.User{ID: "u2", Name: "Grace"}

	cases := []struct {
		name string
		user *db.User
		gh   *db.GithubProfile
	}{
		{"user_only_with_email", ada, nil},
		{"user_only_no_email", userNoEmail, nil},
		{"user_with_github_and_bio", ada, adaGitHub},
		{"user_with_github_no_bio", ada, adaGitHubNoBio},
	}

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()

			first := Generate(tc.user, tc.gh)
			second := Generate(tc.user, tc.gh)

			if first != second {
				t.Fatalf("Generate not deterministic for same input:\n first=%q\nsecond=%q", first, second)
			}
			if strings.TrimSpace(first) == "" {
				t.Fatalf("Generate returned empty intro")
			}
			if !strings.Contains(first, "Go microservice") {
				t.Errorf("intro missing closing source mention: %q", first)
			}
			if !strings.Contains(first, "ECS Fargate") {
				t.Errorf("intro missing ECS Fargate mention: %q", first)
			}

			// Different names should not all collapse to the same sentence.
			other := Generate(&db.User{ID: "u3", Name: "Completely Different Person", Email: "x@y.z"}, tc.gh)
			if tc.user.Name != "Completely Different Person" && first == other {
				t.Errorf("expected different intros for different names but got identical output")
			}
		})
	}
}

func TestGenerate_IncludesGitHubWhenPresent(t *testing.T) {
	t.Parallel()

	u := &db.User{ID: "u1", Name: "Linus", Email: "l@example.com"}
	gh := &db.GithubProfile{
		UserID:      "u1",
		Username:    "torvalds",
		Bio:         sql.NullString{String: "kernel hacker", Valid: true},
		PublicRepos: 5,
		AvatarURL:   "https://x/t.png",
	}
	out := Generate(u, gh)
	if !strings.Contains(out, "@torvalds") {
		t.Errorf("github-backed intro should reference the handle: %q", out)
	}
}

func TestGenerate_NilUser(t *testing.T) {
	t.Parallel()

	if got := Generate(nil, nil); got != "" {
		t.Fatalf("expected empty string for nil user, got %q", got)
	}
}

func TestGenerate_DistinctUsersVary(t *testing.T) {
	t.Parallel()

	users := []string{"Alice", "Bob", "Charlie", "Diana", "Eve"}
	seen := make(map[string]string, len(users))
	for _, name := range users {
		seen[name] = Generate(&db.User{ID: name, Name: name, Email: name + "@x.com"}, nil)
	}
	// At least two distinct users must produce distinct intros.
	distinct := make(map[string]struct{}, len(users))
	for _, v := range seen {
		distinct[v] = struct{}{}
	}
	if len(distinct) < 2 {
		t.Fatalf("expected variation across users, all identical: %v", seen)
	}
}

func TestWords(t *testing.T) {
	t.Parallel()

	cases := []struct {
		in        string
		wantCount int
		wantFirst string
		wantLast  string
	}{
		{"one two three", 3, "one", "three"},
		{"  leading and  trailing  ", 3, "leading", "trailing"},
		{"", 0, "", ""},
		{"single", 1, "single", "single"},
		{"hello, world!", 2, "hello,", "world!"},
	}
	for _, tc := range cases {
		got := Words(tc.in)
		if len(got) != tc.wantCount {
			t.Errorf("Words(%q) len = %d, want %d (%v)", tc.in, len(got), tc.wantCount, got)
			continue
		}
		if tc.wantCount > 0 {
			if got[0] != tc.wantFirst {
				t.Errorf("Words(%q)[0] = %q, want %q", tc.in, got[0], tc.wantFirst)
			}
			if got[len(got)-1] != tc.wantLast {
				t.Errorf("Words(%q)[-1] = %q, want %q", tc.in, got[len(got)-1], tc.wantLast)
			}
		}
	}
}

func TestThinkingMessage(t *testing.T) {
	t.Parallel()

	if m := ThinkingMessage(); m == "" {
		t.Fatal("ThinkingMessage returned empty string")
	}
}
