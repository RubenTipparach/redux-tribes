using System;
using System.Collections;
using System.Collections.Generic;
using System.Linq;
using UnityEngine;

public class MissionGoalProcessor : MonoBehaviour
{
    [Header("Default ship setup")]
    public ShipController[] playerShips;
    public ShipController[] enemyShips;

    [Header("Mission programming")]
    public List<GenericMission> missionList;
    public List<RetreatMission> retreatList;
    public List<GenericMissionFailure> failureConditions;

    public bool completeOneOfObjectives = false;
    // need to introduce objective groups.

    public List<GenericMission> optionalObjectives;

    public bool autoFailAllMissions = false;

    // Start is called before the first frame update
    void Start()
    {
        var missionsTemp = GetComponentsInChildren<GenericMission>();

        //missionList = missionList.Where(p => p.gameObject).ToList(); // only grab active missions    

        var failuresTemp = GetComponentsInChildren<GenericMissionFailure>();

        failureConditions = failuresTemp.Where(p => p.gameObject.activeInHierarchy).ToList();
        Debug.Log(GetMissionText());
        
    }

    public string GetMissionText(){
        var missions = string.Join('\n', missionList.Select(p => $"\t- {p.GenerateMissionText()}"));
        var conditions = string.Join('\n', failureConditions.Select(p => $"\t- {p.GenerateMissionText()}"));
        return 
@$"
<b>PRIMARY MISSION:</b>
{missions}
<color=#411d31>
{conditions}
</color>
";
    }

    // Update is called once per frame
    void Update()
    {
        
    }


    public void AutoFailMission(){
        autoFailAllMissions = true;
    }

    public bool CheckMissionsCompleted()
    {
        if (completeOneOfObjectives)
        {
            foreach(var mission in missionList)
            {
                if (mission.CheckMissionGoald())
                {
                    return true;
                }
            }

            return false;
        }
        else
        {
            foreach (var mission in missionList)
            {
                if (!mission.CheckMissionGoald())
                {
                    return false;
                }
            }
            return true;
        }
    }

    internal bool CheckMissionFailed()
    {
        if (autoFailAllMissions)
        {
            return true;
        }

        foreach(var fail in failureConditions){
            if(fail.CheckMissionFailed())
            {
                return true;
            }
        }

        return false;
    }

    public void InitializeMissions()
    {
        foreach (var m in missionList)
        {
            m.InitializeOnAwake();
        }
    }
}
