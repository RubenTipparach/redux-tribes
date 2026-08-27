using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using System;
using System.Linq;

[CreateAssetMenu(fileName = "MarineEfficiencyTable", menuName = "ShipData/MarineEfficiencyTable", order = 0)]
public class MarineEfficiencyTable : ScriptableObject
{
    public List<MarineEfficiency> marineEfficiencies;

    public int GetMarineEfficenyValue(float shipHealthPercent)
    {
        int efficiency = marineEfficiencies.FirstOrDefault().KillRatio;
        foreach(var ef in marineEfficiencies)
        {
            if(shipHealthPercent <= ef.efficiency)
            {
                efficiency = ef.KillRatio;
            }
        }

        Debug.Log($"Efficiency at deffending is at {efficiency} with hp at {shipHealthPercent}");
        return efficiency;
    }
}

[Serializable]
public class MarineEfficiency{ // this means that my marine can kill 3 per successes, reduce to 2 for .5, and then 1 for .25
    public int KillRatio = 3;

    public float efficiency = .75f;
}
