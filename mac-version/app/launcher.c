/* Main executable for Waypoint.app. macOS 26 won't launch a bundle whose executable is a shell
   script, so this is the smallest real binary that does the same job: exec (same process, so
   one Dock icon) the repo's .venv python on mac-version/app.py. REPO is baked in at build time
   by make-app.command. */
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>

#ifndef REPO
#error "build with -DREPO='\"/path/to/vida-360\"'"
#endif

int main(void) {
    char py[4096], app[4096], logpath[4096];
    snprintf(py, sizeof py, "%s/.venv/bin/python", REPO);
    snprintf(app, sizeof app, "%s/mac-version/app.py", REPO);

    if (access(py, X_OK) != 0) {
        execl("/usr/bin/osascript", "osascript", "-e",
              "display alert \"Waypoint can't find vida-360\" message \"Expected it at " REPO
              ". If you moved the repo, run mac-version/make-app.command again.\"", (char *)NULL);
        return 1;
    }

    const char *home = getenv("HOME");
    if (home) {
        snprintf(logpath, sizeof logpath, "%s/Library/Logs/Waypoint.log", home);
        int fd = open(logpath, O_WRONLY | O_CREAT | O_APPEND, 0644);
        if (fd >= 0) { dup2(fd, 1); dup2(fd, 2); close(fd); }
    }
    if (chdir(REPO) != 0) perror("chdir");
    execl(py, py, app, (char *)NULL);
    perror("exec python");
    return 1;
}
