package runtime

import (
	"fmt"
	"sort"
	"strings"
)

// knownEnvironments are the ENVIRONMENT values the services recognise.
// "production" and "staging" switch on the fail-closed boot policy and the
// strict request-time gates; every other known value is a development mode.
var knownEnvironments = map[string]bool{
	"":            true, // unset: local development and the demo box
	"local":       true,
	"dev":         true,
	"development": true,
	"test":        true,
	"demo":        true,
	"staging":     true,
	"production":  true,
}

// ValidateEnvironment refuses an ENVIRONMENT value the services don't
// recognise. Many checks treat anything other than "production" or
// "staging" as development, so a typo such as "prod" would otherwise boot a
// live deployment with every protection off.
func ValidateEnvironment(raw string) error {
	env := strings.ToLower(strings.TrimSpace(raw))
	if knownEnvironments[env] {
		return nil
	}
	names := make([]string, 0, len(knownEnvironments))
	for name := range knownEnvironments {
		if name != "" {
			names = append(names, name)
		}
	}
	sort.Strings(names)
	return fmt.Errorf("ENVIRONMENT=%q is not recognised; use one of %s, or leave it unset for local development", raw, strings.Join(names, ", "))
}
