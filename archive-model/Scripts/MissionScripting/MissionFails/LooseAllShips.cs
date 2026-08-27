using System.Linq;
using UnityEngine;

public class LooseAllAships : GenericMissionFailure
{
    public string missionTextTemplate = "At least 1 friendly ship must survive.";

    public override string GenerateMissionText()
    {
        return missionTextTemplate;
    }

    public override bool CheckMissionFailed()
    {
        var ships = GameManager.Instance.ships.Where(p => p.isPlayerShip);

        foreach (var ship in ships)
        {
            Debug.Log($"ship {ship.transform.name} is destroyed = {ship.Destroyed}");
            if (!ship.Destroyed)
            {
                return false;
            }
        }

        return true;
    }
}