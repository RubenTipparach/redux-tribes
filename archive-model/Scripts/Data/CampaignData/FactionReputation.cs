using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

[CreateAssetMenu(fileName = "FactionRep", menuName = "Campaign/FactionRep", order = 0)]
public class FactionReputation : ScriptableObject
{
    public List<FactionStatus> factionStatus;

}

[Serializable]
public class FactionStatus{
    [Range(-100, 100)]
    public int factionScore;

    public ShipFaction shipFaction;

    
    public FactionStatus CopyFaction()
    {
        return new FactionStatus()
        {
            factionScore = factionScore,
            shipFaction = shipFaction
        };
    }
}