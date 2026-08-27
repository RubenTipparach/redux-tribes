using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class DestroyedShipFails : GenericMissionFailure
{

    public ShipController[] targetShips;

    public string missionTextTemplate = "The following ship must not be destroyed: ";

    public override string GenerateMissionText()
    {
        return missionTextTemplate + string.Join(' ', targetShips.Select(p =>p.transform.name));
    }

    public override bool CheckMissionFailed()
    {
        var ships = GameManager.Instance.ships.Where(p => p.isPlayerShip);

        foreach (var ship in targetShips)
        {
            if (ship.Destroyed)
            {
                return true;
            }
        }

        return false;
    }
}