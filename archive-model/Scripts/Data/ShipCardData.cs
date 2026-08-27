using System;
using System.Collections;
using System.Collections.Generic;
using UnityEngine;

[CreateAssetMenu(fileName = "ShipCard", menuName = "ShipData/ShipCard", order = 0)]
public class ShipCardData : ScriptableObject
{
    public Sprite shipSprite;

    public Color highlightcolor;
    public Color selectedColor;
    public Color unselectedColor;
    public ShipFaction shipFaction;
    public ShipType shipType;
    public string shipName;
    public string shipRegistryNumber;
    
    public int maxCrew;
    public int maxMarines;

    public string shipVariant = "A";

    public ShipController shipSpawner;

    public Color factionColor;

    public string id;
}

public enum ShipFaction{
    None = 0,
    Terran = 1,
    Karisen = 2,
    GalcticCouncil = 3,
    Benefactors = 4,
    Rebels = 5,
    Cultists = 6,
    Plague = 7,
    Rogue = 8,

}

public enum ShipType
{
    None = 999,
    Fighter = 0,
    Bomber = 1,
    Corvette = 2,
    HeavyCorvette = 3,
    LightFrigate = 4,
    HeavyFrigate = 5,
    LightCruiser = 6,
    MediumCruiser = 7,
    HeavyCruiser = 8,
    MissileCarrier = 9,
    FighterCarrier = 10,
    BomberCarrier = 11,
    BattleCarrier = 12,
    Battleship = 13,
    Dreadnaught = 14,
    Flagship = 15,
    SuperFlagship = 16,
    Mothership = 17,
    Frieghter = 18,
    HeavyFreighter = 19,
    PassengerTransport = 20,
    HeavyPassengerTransport = 21,
    Colony = 22,
    Shuttle = 23,
    Station = 24,
    Shipyard = 25,
    Satellite = 26
}