import { useCallback } from "react";
import {
  setPersistedSelectedClientId,
  setSelectedClientId as setUISelectedClientId,
  useAppDispatch,
  useCollection,
  useUIState
} from "@packages/core-client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useSidebar
} from "@packages/ui";
import { Building2 } from "lucide-react";

export function ClientSelector() {
  const dispatch = useAppDispatch();
  const { state } = useSidebar();

  // Read from store using generic hooks
  const uiState = useUIState();
  const selectedClientId = uiState.selections.selectedClientId;
  const loading = uiState.loading.clients;
  const clients = useCollection("clients");

  const selectedClient = clients.find(
    (client) => client.id === selectedClientId
  );

  const setSelectedClientId = useCallback(
    (clientId: string | null) => {
      dispatch(setUISelectedClientId(clientId));
      if (clientId) {
        dispatch(setPersistedSelectedClientId(clientId));
      }
    },
    [dispatch]
  );
  const isCollapsed = state === "collapsed";

  if (loading) {
    return (
      <div className="py-2 border-b">
        <div className="flex items-center gap-2 h-10">
          <Building2 className="h-4 w-4 animate-pulse" />
          {!isCollapsed && (
            <div className="bg-gray-200 rounded animate-pulse flex-1"></div>
          )}
        </div>
      </div>
    );
  }

  if (isCollapsed) {
    return (
      <div className="py-2">
        <div className="flex items-center justify-center h-10">
          <Building2 className="h-4 w-4" />
        </div>
      </div>
    );
  }

  return (
    <div className="py-2 ">
      <Select
        value={selectedClientId || ""}
        onValueChange={setSelectedClientId}
      >
        <SelectTrigger className="w-full">
          <div className="flex items-center gap-2 min-w-0">
            <Building2 className="h-4 w-4 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              {selectedClient ? (
                <span className="truncate block">{selectedClient.name}</span>
              ) : (
                <SelectValue placeholder="Select client" />
              )}
            </div>
          </div>
        </SelectTrigger>
        <SelectContent>
          {clients.map((client) => (
            <SelectItem key={client.id} value={client.id}>
              <span className="truncate">{client.name}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
