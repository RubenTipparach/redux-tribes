using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using System.Linq;

public class CatpuredAllShips : GenericMission
{
    public ShipController[] targetShips;
    public string missionTextTemplate = "Must CAPTURE enemy ships: ";

    
    public override string GenerateMissionText()
    {
        return missionTextTemplate + string.Join(' ', targetShips.Select(p => p.transform.name));
    }

    public override bool CheckMissionGoald()
    {
        foreach(var ship in targetShips)
        {
            if(ship.isPlayerShip){

                InvokeSuccessOnce();
                return true;
            }
        }

        return false;
    }
}
