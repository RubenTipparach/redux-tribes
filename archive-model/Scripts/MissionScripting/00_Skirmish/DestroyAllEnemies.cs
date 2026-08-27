using System.Collections;
using System.Collections.Generic;
using System.Linq;
using Unity.VisualScripting;
using UnityEngine;

public class DestroyAllEnemies : GenericMission
{
    public string missionTextTemplate = "All enemies must be destroyed or captured.";

    public List<ShipController> additionalShips;

    public override void InitializeOnAwake()
    {
        
    }

    public override string GenerateMissionText()
    {
        return missionTextTemplate;
    }

    public override bool CheckMissionGoald()
    {
        foreach (var t in additionalShips)
        {
            t.shipFaction = GameManager.Instance.enemyFaction;
        }
        
        var ships = GameManager.Instance.ships.Where(p => !p.isPlayerShip && !p.isFriendly).Concat(additionalShips);

        foreach (var ship in ships)
        {
            if (!ship.Destroyed)
            {
                return false;
            }
        }

        onSuccessEvent?.Invoke();
        return true;
    }
}
