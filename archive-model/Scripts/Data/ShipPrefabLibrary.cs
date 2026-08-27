using System.Collections;
using System.Collections.Generic;
using UnityEngine;

[CreateAssetMenu(fileName = "ShipPrefabLibrary", menuName = "ShipData/ShipPrefabLibrary", order = 0)]
public class ShipPrefabLibrary : ScriptableObject
{    
    Dictionary<ShipFaction, ShipFactionPrefabs> shipLibrary = null;

    public List<ShipPrefabData> TerranFaction;

    public Dictionary<ShipFaction, ShipFactionPrefabs> ShipLibrary {
        get {
            if (shipLibrary == null)
            {
                shipLibrary = new Dictionary<ShipFaction, ShipFactionPrefabs>();
                // compile a big list.
                GenerateShipsForFaction(TerranFaction);
            }
            return shipLibrary;
        }
    }

    public ShipPrefabData GetShip(ShipFaction faction, ShipType shipType, string shipVariant)
    {
        return ShipLibrary[faction].shipPrefabs[shipType].shipVariants[shipVariant];
    }

    private void GenerateShipsForFaction(List<ShipPrefabData> shipPrefabs)
    {
        var shipFaction = new ShipFactionPrefabs()
        {
            shipPrefabs = new Dictionary<ShipType, ShipVariants>()
        };

        foreach (var ship in shipPrefabs)
        {
            if (shipFaction.shipPrefabs.ContainsKey(ship.shipType))
            {
                shipFaction.shipPrefabs[ship.shipType]
                    .shipVariants.Add(ship.shipVariant, ship);
            }
            else
            {
                var variants = new ShipVariants()
                {
                    shipVariants = new Dictionary<string, ShipPrefabData>()
                };

                variants.shipVariants.Add(ship.shipVariant, ship);

                shipFaction.shipPrefabs.Add(ship.shipType,
                    variants
                );
            }
        }
    }
}

public class ShipVariants{
    public Dictionary<string, ShipPrefabData> shipVariants = new Dictionary<string, ShipPrefabData>();
}

public class ShipFactionPrefabs{ 
    public Dictionary<ShipType, ShipVariants> shipPrefabs;
}

