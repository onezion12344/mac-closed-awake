// footprint_probe.c — per-process physical footprint through libproc.
//
// This is the quantity Activity Monitor's "Memory" column shows and the one
// the memory-pressure / jetsam logic works from. It is NOT `ps` RSS: for the
// same process we measured 704 MB resident against a 2242 MB footprint,
// because RSS leaves out the compressed pages a process still owns.
//
// Compiled at first run into the app's userData dir (see memory.js), so no
// prebuilt binary ships and nothing needs a signature or notarisation.
//
// Output, one line per readable pid:
//   <pid> <phys_footprint_bytes> <rss_bytes> <bsd_status> <executable_path>
//
// The path matters: `ps -o comm=` prints a bare "sleep" for some processes,
// with no way to tell a system binary from an app. proc_pidpath always gives
// the real path, so the filters in memory.js can actually see what they
// are looking at.

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <libproc.h>

int main(void) {
    int cap = 8192;
    pid_t *pids = malloc(sizeof(pid_t) * cap);
    if (!pids) return 1;

    int n = proc_listpids(PROC_ALL_PIDS, 0, pids, sizeof(pid_t) * cap);
    if (n <= 0) { free(pids); return 1; }
    int count = n / (int)sizeof(pid_t);

    for (int i = 0; i < count; i++) {
        pid_t pid = pids[i];
        if (pid <= 1) continue;

        struct rusage_info_v4 ru;
        memset(&ru, 0, sizeof(ru));
        // EPERM for other users' processes, ESRCH for anything that just
        // exited — both just mean "not listed".
        if (proc_pid_rusage(pid, RUSAGE_INFO_V4, (rusage_info_t *)&ru) != 0) continue;

        struct proc_bsdshortinfo bsd;
        memset(&bsd, 0, sizeof(bsd));
        int status = 0;
        if (proc_pidinfo(pid, PROC_PIDT_SHORTBSDINFO, 0, &bsd, sizeof(bsd)) == (int)sizeof(bsd))
            status = bsd.pbsi_status;   // SIDL SRUN SSLEEP SSTOP SZOMB

        char pathbuf[PROC_PIDPATHINFO_MAXSIZE];
        pathbuf[0] = '\0';
        if (proc_pidpath(pid, pathbuf, sizeof(pathbuf)) <= 0) pathbuf[0] = '\0';

        printf("%d %llu %llu %d %s\n", pid,
               (unsigned long long)ru.ri_phys_footprint,
               (unsigned long long)ru.ri_resident_size,
               status, pathbuf);
    }
    free(pids);
    return 0;
}
