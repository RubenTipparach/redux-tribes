using System;
using System.Collections;
using System.Collections.Generic;
using Unity.VisualScripting;
using UnityEngine;

[CreateAssetMenu(fileName = "WarningPanelMessages", menuName = "Campaign/WarningPanelMessages", order = 0)]
public class WarningPanelMessages : ScriptableObject // TODO: need to assign some sort of action and allow for a view notification button.
{
    public WarningMessage ENEMY_SHIP_CAPTURED;
    public WarningMessage PLAYER_SHIP_DESTROYED;
    public WarningMessage ESCORT_SHIP_DESTROYED;
    public WarningMessage ESCAPE_TO_WAYPOINT;


    public WarningMessage BLOCKADE_PREVENTING_TRANSIT;
    public WarningMessage ENEMY_HAS_ENTERED_FRIENDLY_SYSTEM;
    public WarningMessage FRIENDLY_SYSTEM_WAS_LOST;

    Dictionary<WarningType, WarningMessage> warningMessages;

    public WarningMessage GetWarning(WarningType warningType)
    {
        if (warningMessages == null)
        {
            warningMessages = new Dictionary<WarningType, WarningMessage>();
            ProcessWarning(ENEMY_SHIP_CAPTURED);
            ProcessWarning(PLAYER_SHIP_DESTROYED);
            ProcessWarning(ESCORT_SHIP_DESTROYED);
            ProcessWarning(ESCAPE_TO_WAYPOINT);

            ProcessWarning(BLOCKADE_PREVENTING_TRANSIT);
            ProcessWarning(ENEMY_HAS_ENTERED_FRIENDLY_SYSTEM);
            ProcessWarning(FRIENDLY_SYSTEM_WAS_LOST);
        }

        return warningMessages[warningType];
    }

    private void ProcessWarning(WarningMessage warningMessage)
    {
        warningMessages.Add(warningMessage.warningType, warningMessage);
    }
}


public enum WarningType {
    ENEMY_SHIP_CAPTURED = 101,
    PLAYER_SHIP_DESTROYED = 102,
    ESCORT_SHIP_DESTROYED = 103,
    ESCAPE_TO_WAYPOINT = 104,

    // campaign relevant fields
    BLOCKADE_PREVENTING_TRANSIT = 105,
    ENEMY_HAS_ENTERED_FRIENDLY_SYSTEM = 106,
    FRIENDLY_SYSTEM_WAS_LOST = 107
    
}

[Serializable]
public class WarningMessage{
    public WarningType warningType;
    public string warning;
}