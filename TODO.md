- I changed my mind I want the monitored cpu and memory to be monitored at process level no machine, since in some cases teh node process may be started not with maximum of teh machine but with a limit. Because of that in our instances table we should save the process mem and cpu used in percentage not the machine one.
Also let's update the instances page in dashboard have in parenthesis that is per (process), also update docs if needed.
Also make sure that in all parts also where we check the systemLimiter we use the ones per process not per machine.

Linux and Mac work similarly, and marks memory as used even tho it is just allocated to a process not really used, thats why the node.os always shows mem used as 90%+ while in fact the memory is just allocated to some processes, and not really used.
We need to go back to per process, and have in docs in the Going to production page, saying that our suggestion is if only this process will run on that machine is to increase the node default allocated memory, since if the machine may have a lot of ram, node may not consume all if not allocating more in the config.
